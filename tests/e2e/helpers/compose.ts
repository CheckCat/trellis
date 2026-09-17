// Жизненный цикл реального стека для сквозного smoke-теста: поднять
// docker-compose-стек в изолированном проекте, дождаться готовности по
// healthcheck'ам и погасить его, что бы ни случилось с тестом.
//
// Три вещи, которые этот модуль обязан гарантировать, и почему:
//
//   - Изоляция от рабочего стека пользователя. Всё идёт под именем проекта
//     `trellis-e2e` (никогда `trellis`) и с override-файлом
//     docker-compose.e2e.yml: свой одноразовый том, эфемерные порты.
//     Тест не должен ни удалять чужие контейнеры, ни писать прогресс в
//     базу, которой пользователь пользуется.
//   - Готовность — по healthcheck'ам, а не по `sleep` (инвариант проекта).
//     Этим занимается `docker compose up --wait`; у всех трёх сервисов
//     healthcheck объявлен в docker-compose.yml, причём у frontend он
//     ходит в /api/health ЧЕРЕЗ nginx, так что зелёный `--wait` уже
//     означает «вся цепочка nginx → backend → postgres жива».
//   - Никакого `docker compose down -v`. Том данных удаляется адресно, по
//     имени (`trellis-e2e-pgdata`): `-v` удаляет тома из объединённой
//     модели, и одна неудачная правка override-файла превратила бы уборку
//     после теста в удаление прогресса пользователя (trellis_pgdata).
//     Удаление по имени ошибиться так не может.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Имя compose-проекта тестового стека. Отдельное от `trellis` (имя из
 * docker-compose.yml) — именно оно разводит контейнеры, сеть и образы. */
const PROJECT_NAME = "trellis-e2e";

/** Том данных Postgres тестового стека (`name:` в override-файле). */
const DATA_VOLUME = "trellis-e2e-pgdata";

const OVERRIDE_FILE = "tests/e2e/docker-compose.e2e.yml";

/** Сколько ждать готовности стека. Первый прогон включает сборку обоих
 * образов (npm ci внутри), поэтому запас большой; на прогретых слоях
 * реальное ожидание — десятки секунд. */
const START_TIMEOUT_SECONDS = 600;

/**
 * Пароли тестового стека. Задаются явно, а не берутся из корневого .env:
 * compose подхватывает .env автоматически, и тест, молча работающий на
 * паролях разработчика, зависел бы от незакоммиченного файла. Переменные
 * окружения процесса имеют приоритет над .env — значения ниже выигрывают.
 * Секретами они не являются: стек живёт минуты, слушает только 127.0.0.1 и
 * стирается вместе с томом.
 */
const STACK_ENV: Readonly<Record<string, string>> = {
  POSTGRES_PASSWORD: "e2e-postgres-superuser",
  APP_DB_PASSWORD: "e2e-app-role",
  SANDBOX_DB_PASSWORD: "e2e-sandbox-role",
};

/** Оставить стек поднятым после теста — для ручного разбора падения
 * (`TRELLIS_E2E_KEEP_STACK=1 npm run test:e2e`). */
const KEEP_STACK_ENV = "TRELLIS_E2E_KEEP_STACK";

export interface StackHandle {
  /** Адрес приложения — то, что открывает пользователь: nginx фронтенда. */
  readonly appUrl: string;
  /** Тот же nginx, префикс /api — backend ровно так, как до него ходит
   * браузер (frontend никогда не ходит в backend мимо этого пути). */
  readonly apiUrl: string;
  /** Логи всех сервисов — чтобы упавший тест мог показать, что случилось. */
  logs(): Promise<string>;
  /** Гасит стек и удаляет его том. Идемпотентна. */
  stop(): Promise<void>;
}

/**
 * Поднимает стек и возвращает его адреса. Всегда начинает с чистого листа:
 * остатки прошлого прогона (в том числе прерванного) сносятся до `up`,
 * поэтому база на старте теста гарантированно пустая, а не «какая
 * осталась».
 */
export async function startStack(): Promise<StackHandle> {
  await assertDockerAvailable();
  await tearDown();

  const started = await compose(
    ["up", "--detach", "--build", "--wait", "--wait-timeout", String(START_TIMEOUT_SECONDS)],
    { stream: true },
  );
  if (started.code !== 0) {
    const logs = await compose(["logs", "--no-color", "--tail", "80"]);
    await tearDown();
    throw new Error(
      `Не удалось поднять стек ${PROJECT_NAME} (docker compose up завершился с кодом ${started.code}).\n` +
        `${started.stderr.trim()}\n--- логи сервисов ---\n${logs.stdout.trim()}`,
    );
  }

  const appUrl = await publishedUrl("frontend", 80);
  let stopped = false;
  return {
    appUrl,
    apiUrl: `${appUrl}/api`,
    logs: async () => (await compose(["logs", "--no-color", "--tail", "200"])).stdout,
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (process.env[KEEP_STACK_ENV] === "1") {
        process.stderr.write(
          `${KEEP_STACK_ENV}=1 — стек ${PROJECT_NAME} оставлен поднятым (${appUrl}). ` +
            `Погасить вручную: docker compose -p ${PROJECT_NAME} -f docker-compose.yml -f ${OVERRIDE_FILE} down\n`,
        );
        return;
      }
      await tearDown();
    },
  };
}

/** Внешний адрес опубликованного порта сервиса: `docker compose port` —
 * единственный источник правды о том, куда Docker отдал эфемерный порт. */
async function publishedUrl(service: string, containerPort: number): Promise<string> {
  const result = await compose(["port", service, String(containerPort)]);
  const address = result.stdout.trim();
  if (result.code !== 0 || address === "") {
    throw new Error(
      `Сервис ${service} не опубликовал порт ${containerPort} (docker compose port: код ${result.code}). ` +
        `${result.stderr.trim()}`,
    );
  }
  return `http://${address}`;
}

/** Гасит контейнеры и удаляет ТОЛЬКО том тестового стека. Ошибки не
 * поднимает: гасить нечего — уже хорошо. */
async function tearDown(): Promise<void> {
  await compose(["down", "--remove-orphans", "--timeout", "5"]);
  await run("docker", ["volume", "rm", "--force", DATA_VOLUME]);
}

async function assertDockerAvailable(): Promise<void> {
  const version = await run("docker", ["compose", "version"]);
  if (version.code !== 0) {
    throw new Error(
      "Сквозной тест поднимает настоящий стек и без Docker Compose выполнен быть не может " +
        "(это не «пропускаемый» тест: зелёный прогон без стека ничего бы не доказывал). " +
        `Проверьте \`docker compose version\`: ${version.stderr.trim()}`,
    );
  }
}

function compose(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return run(
    "docker",
    ["compose", "--project-name", PROJECT_NAME, "--file", "docker-compose.yml", "--file", OVERRIDE_FILE, ...args],
    options,
  );
}

interface RunOptions {
  /** Дублировать вывод команды в stderr прогона — для долгих шагов
   * (сборка образов), чтобы прогон не выглядел зависшим. */
  readonly stream?: boolean;
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Запускает команду в корне репозитория и собирает её вывод. Ненулевой код
 * возвращается вызывающему, а не бросается: почти все вызовы здесь —
 * уборка, где «не получилось» ожидаемо. */
function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd: repoRoot(),
      // Пути в docker-compose.yml относительны каталога проекта (корень
      // репозитория), поэтому cwd здесь обязателен — тест может быть
      // запущен откуда угодно.
      env: { ...process.env, ...STACK_ENV },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (options.stream === true) {
        process.stderr.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (options.stream === true) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

let cachedRepoRoot: string | undefined;

/** Корень репозитория — каталог, где лежат package.json и
 * docker-compose.yml. Ищется вверх от этого модуля, а не берётся из
 * process.cwd(): так тест одинаково работает и из npm-скрипта, и при
 * ручном запуске `node --test` из любого каталога. */
function repoRoot(): string {
  if (cachedRepoRoot !== undefined) {
    return cachedRepoRoot;
  }
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(directory, "docker-compose.yml")) && existsSync(join(directory, "package.json"))) {
      cachedRepoRoot = directory;
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Не найден корень репозитория (каталог с package.json и docker-compose.yml) выше tests/e2e.");
    }
    directory = parent;
  }
}
