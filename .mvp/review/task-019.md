# Review: task 019

## Commits (4aba7f637cce21bd190f39da7f4f8d5a1716db55..HEAD)


## Diffstat (4aba7f637cce21bd190f39da7f4f8d5a1716db55 -> working tree)

 .mvp/ledger.md    | 7 +++++++
 CLAUDE.md         | 6 ++++++
 package-lock.json | 1 +
 package.json      | 9 ++++++---
 4 files changed, 20 insertions(+), 3 deletions(-)

## Diff (4aba7f637cce21bd190f39da7f4f8d5a1716db55 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index 4345cc6..c4a21e0 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -30,3 +30,10 @@ Task 016: complete (ca809067e2c36408022cb50bb5bec9d401483943)
   concern (task 017): declared-files hint mismatch (non-blocking, initial): missing-declared: courses/pilot-sql/lessons/
   concern (task 017): review split: 2 finding(s) came from a minority of 3 polls — the others approved
 Task 017: complete (5504fba8cfb130ae1d194dd7b108925d5769a353)
+  concern (task 018): CONCERN 1: Windows в этом окружении нет — `start.bat` и ветка автозапуска Docker Desktop (`$IsWindows`) не исполнялись ни разу, вычитаны построчно; совместимость с Windows PowerShell 5.1 обеспечена конструктивно, но не подтверждена прогоном. Сам `start.ps1` прогнан под PowerShell 7.4.6 на macOS против настоящего стека: чистый старт с нуля, занятый порт, обрыв связи с Docker Hub, crash-loop backend по паролю, восстановление `-SyncPasswords` без потери тома, невалидный `.env` — все ветки дали ожид
+  concern (task 018): review split: 5 finding(s) came from a minority of 3 polls — the others approved
+  concern (task 018): review finding refuted, not fixed: {"severity":"bug","file":"start.ps1","line":318,"quote":"$containerId = Get-ServiceContainerId -Service $Service\n    if ($containerId.Length -eq 0) {\n        Stop-WithProblem -Title \"контейнер '$Service' не создан\" -Hints @(","summary":"Refuted: independently reproduced on real Docker 28.1.1/Com
+  concern (task 018): review finding refuted, not fixed: {"severity":"minor","file":".gitattributes","line":8,"quote":"*.bat text eol=crlf\n*.ps1 text eol=crlf","summary":"Refuted: brief's file list (verified in .mvp/briefs/task-018.md) is a scope hint not a contract, and the file is a documented technical dependency of the two declared deliverables (cmd.
+Task 018: complete (4aba7f637cce21bd190f39da7f4f8d5a1716db55)
+  Ruling (task 018): Windows-ветки (start.bat, автозапуск Docker Desktop) не исполнялись — Windows в окружении нет; start.ps1 прогнан под PowerShell 7.4.6 на macOS по шести сценариям. Принято как есть; первый запуск на реальной Windows — приёмочная проверка за пользователем. Цена ошибки: средняя — это единственный пользовательский вход на целевой ОС, smoke-тест 019 его не покрывает.
+  Ruling (task 018): ревью-сплит и две опровергнутые находки (start.ps1:318, .gitattributes:8) закрыты re-review, не fix-агентом — вердикт выносил отдельный проход, поэтому findings не применялись осознанно, а не по пропуску.
diff --git a/CLAUDE.md b/CLAUDE.md
index fabb7d3..2ef699d 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -23,6 +23,12 @@ npm run test --if-present
 
 Запуск стека для разработки: `docker compose up` (отдельного dev-скрипта нет; `.ps1`/`.bat` — только пользовательская упаковка).
 
+Сквозной smoke-тест собранного стека — отдельной командой, в `npm run test` и в CI он не входит (поднимает docker-compose-стек, нужен Docker Compose >= 2.24):
+
+```bash
+npm run test:e2e                # tests/e2e/stack.test.ts; типы и линт этого каталога проверяет общий lint/build
+```
+
 ## Правила
 
 - Ядро не знает о конкретном курсе: никакого хардкода названий/структуры курса в коде; курс — данные из `courses/` (manifest.yaml + Markdown), валидируемые по схеме до показа.
diff --git a/package-lock.json b/package-lock.json
index d1aad30..e5c71a7 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -10,6 +10,7 @@
       ],
       "devDependencies": {
         "@eslint/js": "^10.0.1",
+        "@types/node": "^22.20.2",
         "eslint": "^10.10.0",
         "typescript": "^6.0.3",
         "typescript-eslint": "^8.70.0"
diff --git a/package.json b/package.json
index 3ec22c1..2f13ea1 100644
--- a/package.json
+++ b/package.json
@@ -9,13 +9,16 @@
     "node": ">=22"
   },
   "scripts": {
-    "lint": "npm run lint --workspaces --if-present",
-    "build": "npm run build --workspaces --if-present",
+    "lint": "npm run lint --workspaces --if-present && eslint tests",
+    "build": "npm run build --workspaces --if-present && tsc -p tests/e2e/tsconfig.json",
     "pretest": "node scripts/check-text-sources.mjs",
-    "test": "npm run test --workspaces --if-present"
+    "test": "npm run test --workspaces --if-present",
+    "pretest:e2e": "tsc -p tests/e2e/tsconfig.json",
+    "test:e2e": "node --test 'tests/e2e/dist/**/*.test.js'"
   },
   "devDependencies": {
     "@eslint/js": "^10.0.1",
+    "@types/node": "^22.20.2",
     "eslint": "^10.10.0",
     "typescript": "^6.0.3",
     "typescript-eslint": "^8.70.0"
```

## Untracked files (new, not yet added)

### tests/e2e/docker-compose.e2e.yml

```
# Override для сквозного smoke-теста (tests/e2e/stack.test.ts).
#
# Применяется ТОЛЬКО вместе с корневым docker-compose.yml и только под
# отдельным именем проекта (`docker compose -p trellis-e2e -f
# docker-compose.yml -f tests/e2e/docker-compose.e2e.yml ...`, см.
# helpers/compose.ts). Задача файла — одна: сделать тестовый стек полностью
# изолированным от стека, который пользователь мог поднять для работы, не
# трогая при этом сам docker-compose.yml. Образы, healthcheck'и, переменные
# окружения и порядок зависимостей остаются ровно теми же, что и в проде —
# иначе smoke-тест проверял бы не ту конфигурацию, которую запускает
# пользователь.
#
# Требуется Docker Compose >= 2.24 — из-за тега `!override` (см. ниже).

services:
  postgres:
    # `!override`, а не просто список: последовательности `ports` compose
    # по умолчанию СКЛАДЫВАЕТ (проверено `docker compose config`), и без
    # этого тега тестовый стек унаследовал бы фиксированные 5433/3001/3000
    # из базового файла и падал бы с "port is already allocated" ровно
    # тогда, когда у разработчика уже поднят рабочий стек. Пустой host-порт
    # (`127.0.0.1::5432`) отдаёт выбор Docker'у; фактический порт тест
    # узнаёт через `docker compose port` — фиксированных портов тут нет
    # вообще. Привязка к 127.0.0.1 сохранена (инвариант: наружу ничего).
    ports: !override
      - "127.0.0.1::5432"
    # Здесь `!override` НЕ нужен и был бы вреден: `volumes` compose сливает
    # по target-пути, поэтому эта запись заменяет ровно монтирование
    # /var/lib/postgresql/data (боевой том trellis_pgdata → одноразовый
    # trellis-e2e-pgdata), а bind-монтирования init-скриптов из базового
    # файла остаются на месте. Прогресс пользователя в trellis_pgdata этот
    # стек не открывает вовсе — не «не пишет», а физически не видит.
    volumes:
      - trellis_e2e_pgdata:/var/lib/postgresql/data

  backend:
    ports: !override
      - "127.0.0.1::3001"

  frontend:
    ports: !override
      - "127.0.0.1::80"

volumes:
  trellis_e2e_pgdata:
    # Явное имя (не `trellis-e2e_trellis_e2e_pgdata`), чтобы teardown мог
    # удалить том адресно, по имени, вместо `docker compose down -v` —
    # см. helpers/compose.ts.
    name: trellis-e2e-pgdata
```

### tests/e2e/helpers/compose.ts

```
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
```

### tests/e2e/stack.test.ts

```
// Сквозной smoke-тест поднятого стека.
//
// Это единственный тест в репозитории, который работает не с модулем и не с
// `app.inject()`, а с настоящим стеком: docker-compose поднимает postgres,
// backend и frontend, и дальше тест ходит по HTTP ровно туда, куда ходит
// браузер пользователя — в nginx фронтенда, с префиксом /api. Всё, что
// проверяется ниже, проверяется через эту цепочку целиком (nginx → backend →
// postgres → песочница), поэтому падение здесь означает «собранный продукт
// не работает», а не «функция вернула не то».
//
// Почему его нет в `npm test` (и, значит, в .mvp/ci-mirror.sh и CI): он
// собирает и поднимает образы и требует Docker. Запускается отдельно —
// `npm run test:e2e`; типы и линт при этом проверяются на общих основаниях
// (`npm run build` компилирует этот каталог, `npm run lint` его линтит), так
// что тест не гниёт незаметно между запусками.
//
// Тест намеренно написан как ОДИН сценарий с упорядоченными шагами, а не как
// набор независимых тестов: состояние (прогресс, песочница) накапливается в
// одной живой базе, и «отметить урок пройденным» имеет смысл ровно после
// того, как курс провалидирован и виден. Независимость здесь достигалась бы
// только пересозданием стека на каждый шаг — минуты на шаг без единого
// нового утверждения о продукте.

import assert from "node:assert/strict";
import test from "node:test";

import { startStack } from "./helpers/compose.js";

/**
 * Что тест знает о пилотном контент-пакете (courses/pilot-sql, задача 017).
 * Это фикстура теста, а не знание ядра: backend и frontend получают всё это
 * из данных, здесь же оно перечислено потому, что проверить «квиз
 * засчитывается» можно, только зная верный вариант — API его не отдаёт (и
 * не должен). Если пилотный курс меняется, правится этот блок, а не шаги.
 */
const PILOT = {
  courseId: "pilot-sql",
  courseVersion: "1.0.0",
  totalLessons: 7,
  /** Урок без квиза и практики — закрывается только самоотметкой. */
  manualLesson: "what-is-sql",
  quizLesson: "select-basics",
  quizCorrectOption: "select",
  quizWrongOption: "insert",
  /** Практика без check — «самоотметка для заданий без check». */
  selfCheckedPracticeLesson: "practice-instock",
  selfCheckedPracticeSql: "select title, author from books where in_stock = true",
  /** Практика с check — засчитывается самим движком. */
  checkedPracticeLesson: "practice-add-book",
  checkedPracticeSolution:
    "insert into books (title, author, published_year, in_stock) " +
    "values ('Мастер и Маргарита', 'Михаил Булгаков', 1967, true)",
  checkedPracticeBookTitle: "Мастер и Маргарита",
  /** Урок, которого нет в прогрессе к моменту импорта, — им проверяется
   * round-trip: файл экспорта дочитывается обратно и меняет прогресс. */
  importedLesson: "wrap-up",
} as const;

// --- Формы ответов, на которые тест опирается (подмножество JSON Schema
// маршрутов backend'а: только поля, которые действительно проверяются) ----

interface CourseSummary {
  readonly id: string;
  readonly version: string;
  readonly title: string;
}

interface CourseDetail {
  readonly id: string;
  readonly version: string;
  readonly modules: readonly { readonly id: string; readonly lessons: readonly { readonly id: string }[] }[];
}

interface LessonDetail {
  readonly id: string;
  readonly content?: string;
  readonly quiz?: { readonly question: string; readonly options: readonly { readonly id: string }[] };
  readonly practice?: { readonly sandbox: string; readonly prompt: string };
}

interface LessonProgress {
  readonly id: string;
  readonly status: "completed" | "not_started";
  readonly completionMode: "manual" | "quiz" | "practice";
}

interface CourseCounters {
  readonly courseId: string;
  readonly courseVersion: string;
  readonly completedLessons: number;
  readonly completed: boolean;
}

interface CourseProgress extends CourseCounters {
  readonly totalLessons: number;
  readonly modules: readonly { readonly lessons: readonly LessonProgress[] }[];
}

interface CompletionResponse {
  readonly lesson: LessonProgress;
  readonly course: CourseCounters;
}

interface QuizAnswerResponse extends CompletionResponse {
  readonly correct: boolean;
  readonly explanation?: string;
}

interface PracticeRunResponse extends CompletionResponse {
  readonly ok: boolean;
  readonly result?: {
    readonly columns: readonly { readonly name: string }[];
    readonly rows: readonly (readonly (string | null)[])[];
  };
  readonly error?: { readonly message: string; readonly code?: string };
  readonly check: { readonly present: boolean; readonly passed?: boolean };
}

interface SandboxStatus {
  readonly active: boolean;
  readonly sandboxId?: string;
  readonly seedFiles?: readonly string[];
}

interface ExportedLesson {
  readonly lessonId: string;
  readonly status: "completed";
  readonly completedAt: string;
  readonly courseVersion?: string;
}

interface ProgressExportFile {
  readonly format: string;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly courses: readonly {
    readonly courseId: string;
    readonly installedVersion?: string;
    readonly lessons: readonly ExportedLesson[];
  }[];
}

interface ImportResult {
  readonly applied: boolean;
  readonly stale: boolean;
  readonly error?: string;
  readonly summary: {
    readonly courses: number;
    readonly lessons: number;
    readonly created: number;
    readonly earlierCompletions: number;
    readonly unchanged: number;
  };
  readonly coursesNotInstalled: readonly string[];
}

interface RescanResponse {
  readonly accepted: number;
  readonly rejected: number;
  readonly scanFailed: boolean;
}

// Полчаса потолка: первый прогон собирает оба образа с нуля (npm ci внутри),
// на прогретых слоях сценарий укладывается в пару минут. Потолок нужен,
// чтобы зависший стек не держал прогон вечно.
const SCENARIO_TIMEOUT_MS = 30 * 60 * 1000;

void test("поднятый стек проходит сквозной пользовательский сценарий", { timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const stack = await startStack();
  const api = new ApiClient(stack.apiUrl);
  // Собирается по ходу сценария и сверяется с ответами API: так тест
  // утверждает не «счётчик вырос», а «пройдено ровно это».
  const completed = new Set<string>();

  try {
    await t.test("nginx отдаёт SPA, а /api/health — живую связку с базой", async () => {
      const page = await fetch(stack.appUrl);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await page.text(), /<div id="root">/);

      const health = await api.get<{ status: string; db: string }>("/health");
      assert.equal(health.status, 200);
      assert.deepEqual(health.body, { status: "ok", db: "ok" });
    });

    await t.test("контент-пакет из courses/ проходит валидацию и виден в API", async () => {
      const rescan = await api.post<RescanResponse>("/courses/rescan");
      assert.equal(rescan.status, 200);
      assert.equal(rescan.body.scanFailed, false);
      assert.equal(rescan.body.rejected, 0, "ни один пакет в courses/ не должен быть отвергнут валидацией");
      assert.ok(rescan.body.accepted >= 1);

      const list = await api.get<{ courses: readonly CourseSummary[] }>("/courses");
      assert.equal(list.status, 200);
      const course = list.body.courses.find((candidate) => candidate.id === PILOT.courseId);
      assert.ok(course !== undefined, `курс ${PILOT.courseId} не виден в /courses`);
      assert.equal(course.version, PILOT.courseVersion);
      assert.notEqual(course.title, "");

      const detail = await api.get<CourseDetail>(`/courses/${PILOT.courseId}`);
      assert.equal(detail.status, 200);
      const lessonIds = detail.body.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
      assert.equal(lessonIds.length, PILOT.totalLessons);
      assert.ok(lessonIds.includes(PILOT.quizLesson));
    });

    await t.test("урок отдаётся с Markdown-контентом, но без ответов курса", async () => {
      const lesson = await api.get<LessonDetail>(`/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}`);
      assert.equal(lesson.status, 200);
      assert.ok((lesson.body.content ?? "").length > 0, "урок должен нести Markdown-контент");
      assert.ok(lesson.body.quiz !== undefined);
      assert.ok(lesson.body.quiz.options.length > 1);
      // Верный вариант и check-запрос — это ответы к заданиям курса; они
      // не покидают backend ни в каком виде. Проверяется по сырому телу
      // ответа, а не по типам: типы описывают то, что тест ожидает, а
      // утечка была бы как раз полем, которого он не ожидает.
      assert.doesNotMatch(lesson.raw, /"correct"/);
      assert.doesNotMatch(lesson.raw, /"explanation"/);

      const practice = await api.get<LessonDetail>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}`,
      );
      assert.equal(practice.status, 200);
      assert.ok(practice.body.practice !== undefined);
      assert.doesNotMatch(practice.raw, /"check"/);
    });

    await t.test("прогресс нового стека пуст", async () => {
      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.status, 200);
      assert.equal(progress.body.totalLessons, PILOT.totalLessons);
      assert.equal(progress.body.completedLessons, 0);
      assert.equal(progress.body.completed, false);
    });

    await t.test("урок отмечается пройденным, а урок с квизом — не отмечается руками", async () => {
      const marked = await api.post<CompletionResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.manualLesson}/complete`,
      );
      assert.equal(marked.status, 200);
      assert.equal(marked.body.lesson.status, "completed");
      assert.equal(marked.body.lesson.completionMode, "manual");
      completed.add(PILOT.manualLesson);
      assert.equal(marked.body.course.completedLessons, completed.size);

      // Ручная отметка урока, который закрывается квизом, — 409: иначе квиз
      // был бы декоративным (инвариант зачёта).
      const refused = await api.post<{ error: string }>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/complete`,
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error, "manual_completion_not_allowed");
    });

    await t.test("квиз: неверный ответ не засчитывает урок, верный — засчитывает", async () => {
      const wrong = await api.post<QuizAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/quiz/answer`,
        { optionId: PILOT.quizWrongOption },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.correct, false);
      assert.equal(wrong.body.lesson.status, "not_started");
      assert.equal(wrong.body.course.completedLessons, completed.size);

      const right = await api.post<QuizAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/quiz/answer`,
        { optionId: PILOT.quizCorrectOption },
      );
      assert.equal(right.status, 200);
      assert.equal(right.body.correct, true);
      assert.equal(right.body.lesson.status, "completed");
      completed.add(PILOT.quizLesson);
      assert.equal(right.body.course.completedLessons, completed.size);
    });

    await t.test("SQL практики выполняется в песочнице курса", async () => {
      const before = await api.get<SandboxStatus>(`/courses/${PILOT.courseId}/sandbox`);
      assert.equal(before.status, 200);
      assert.equal(before.body.active, false, "песочница поднимается по первому запуску практики, не раньше");

      const run = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.selfCheckedPracticeLesson}/practice/run`,
        { sql: PILOT.selfCheckedPracticeSql },
      );
      assert.equal(run.status, 200);
      assert.equal(run.body.ok, true, `SQL не выполнился: ${run.raw}`);
      assert.deepEqual(
        run.body.result?.columns.map((column) => column.name),
        ["title", "author"],
      );
      assert.ok((run.body.result?.rows.length ?? 0) > 0, "seed курса должен быть применён — строки есть");
      // Задание без check — самоотметка: движок его не засчитывает.
      assert.deepEqual(run.body.check, { present: false });
      assert.equal(run.body.lesson.status, "not_started");

      const after = await api.get<SandboxStatus>(`/courses/${PILOT.courseId}/sandbox`);
      assert.equal(after.body.active, true);
      assert.deepEqual(after.body.seedFiles, ["sandbox/seed.sql"]);

      const marked = await api.post<CompletionResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.selfCheckedPracticeLesson}/complete`,
      );
      assert.equal(marked.status, 200);
      assert.equal(marked.body.lesson.status, "completed");
      completed.add(PILOT.selfCheckedPracticeLesson);
      assert.equal(marked.body.course.completedLessons, completed.size);
    });

    await t.test("ошибка Postgres доходит до клиента как есть, а не как сбой API", async () => {
      const broken = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.selfCheckedPracticeLesson}/practice/run`,
        { sql: "select * from no_such_table_here" },
      );
      assert.equal(broken.status, 200, "ошибка в учебном SQL — это не ошибка HTTP");
      assert.equal(broken.body.ok, false);
      assert.equal(broken.body.error?.code, "42P01");
      assert.ok((broken.body.error?.message ?? "").length > 0);
    });

    await t.test("SQL пользователя исполняется под ролью песочницы — данные ядра ему недоступны", async () => {
      const forbidden = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.selfCheckedPracticeLesson}/practice/run`,
        { sql: "select * from core.lesson_progress" },
      );
      assert.equal(forbidden.status, 200);
      assert.equal(forbidden.body.ok, false, "песочница не должна читать схему ядра");
      // 42501 — insufficient_privilege. Роль песочницы не имеет прав на
      // схему core, где лежит прогресс: ровно то, ради чего заведены две
      // роли.
      assert.equal(forbidden.body.error?.code, "42501", `неожиданная ошибка: ${forbidden.raw}`);
    });

    await t.test("практика с check засчитывает урок только по успешной проверке", async () => {
      const wrong = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}/practice/run`,
        { sql: "select count(*) from books" },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.ok, true);
      assert.deepEqual(wrong.body.check, { present: true, passed: false });
      assert.equal(wrong.body.lesson.status, "not_started");

      const solved = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}/practice/run`,
        { sql: PILOT.checkedPracticeSolution },
      );
      assert.equal(solved.status, 200);
      assert.equal(solved.body.ok, true, `решение не выполнилось: ${solved.raw}`);
      assert.deepEqual(solved.body.check, { present: true, passed: true });
      assert.equal(solved.body.lesson.status, "completed");
      assert.equal(solved.body.lesson.completionMode, "practice");
      completed.add(PILOT.checkedPracticeLesson);
      assert.equal(solved.body.course.completedLessons, completed.size);
    });

    await t.test("сброс песочницы возвращает данные курса к исходным, прогресс остаётся", async () => {
      const reset = await api.post<SandboxStatus>(`/courses/${PILOT.courseId}/sandbox/reset`);
      assert.equal(reset.status, 200);
      assert.equal(reset.body.active, true);

      const run = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.selfCheckedPracticeLesson}/practice/run`,
        { sql: `select count(*) as n from books where title = '${PILOT.checkedPracticeBookTitle}'` },
      );
      assert.equal(run.body.ok, true);
      assert.deepEqual(run.body.result?.rows, [["0"]], "после сброса песочница должна быть как после seed");

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size, "сброс песочницы не трогает прогресс");
    });

    await t.test("экспорт даёт версионированный файл с зачётами и версиями курсов", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      assert.equal(exported.status, 200);
      assert.equal(exported.body.format, "trellis.progress");
      assert.equal(exported.body.formatVersion, 1);
      assert.ok(!Number.isNaN(Date.parse(exported.body.exportedAt)), "метка времени должна быть разбираемой датой");

      const course = exported.body.courses.find((candidate) => candidate.courseId === PILOT.courseId);
      assert.ok(course !== undefined);
      assert.equal(course.installedVersion, PILOT.courseVersion);
      assert.deepEqual(
        course.lessons.map((lesson) => lesson.lessonId).sort(),
        [...completed].sort(),
        "в файле — ровно пройденные уроки",
      );
    });

    await t.test("импорт того же файла ничего не меняет", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      const imported = await api.post<ImportResult>("/progress/import", exported.body);
      assert.equal(imported.status, 200);
      assert.equal(imported.body.applied, true);
      assert.equal(imported.body.stale, false);
      assert.deepEqual(imported.body.summary, {
        // Ровно то, что лежит в файле: курсы с прогрессом и их уроки.
        courses: exported.body.courses.length,
        lessons: completed.size,
        created: 0,
        earlierCompletions: 0,
        unchanged: completed.size,
      });
      assert.deepEqual(imported.body.coursesNotInstalled, []);

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size);
    });

    await t.test("более старый файл сначала предупреждает, а после подтверждения применяется", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      const dayEarlier = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      // Файл «со второго компьютера»: старше местного прогресса и несёт один
      // зачёт, которого здесь нет.
      const olderFile: ProgressExportFile = {
        ...exported.body,
        exportedAt: dayEarlier,
        courses: exported.body.courses.map((course) =>
          course.courseId === PILOT.courseId
            ? {
                ...course,
                lessons: [
                  ...course.lessons,
                  {
                    lessonId: PILOT.importedLesson,
                    status: "completed",
                    completedAt: dayEarlier,
                    courseVersion: PILOT.courseVersion,
                  },
                ],
              }
            : course,
        ),
      };

      const warned = await api.post<ImportResult>("/progress/import", olderFile);
      assert.equal(warned.status, 409);
      assert.equal(warned.body.error, "import_older_than_local");
      assert.equal(warned.body.applied, false);
      assert.equal(warned.body.stale, true);
      assert.equal(warned.body.summary.created, 1, "предупреждение показывает, что файл добавил бы");

      const unchangedProgress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(unchangedProgress.body.completedLessons, completed.size, "до подтверждения не пишется ничего");

      const confirmed = await api.post<ImportResult>("/progress/import?confirm=true", olderFile);
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.applied, true);
      assert.equal(confirmed.body.summary.created, 1);
      completed.add(PILOT.importedLesson);

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size);
      const restored = progress.body.modules
        .flatMap((module) => module.lessons)
        .find((lesson) => lesson.id === PILOT.importedLesson);
      assert.equal(restored?.status, "completed", "урок из файла виден в дереве курса как пройденный");
    });
  } catch (error) {
    // Падение сквозного теста почти всегда объясняется логами сервисов, а
    // не стеком вызовов в тесте: стек к моменту чтения отчёта уже погашен.
    process.stderr.write(`--- логи стека ---\n${await stack.logs()}\n`);
    throw error;
  } finally {
    await stack.stop();
  }
});

interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
  /** Сырое тело — для утверждений о том, чего в ответе быть НЕ должно. */
  readonly raw: string;
}

/** Минимальный HTTP-клиент поверх fetch: тест ходит в стек ровно так же,
 * как фронтенд, — через nginx и префикс /api. */
class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return await this.send<T>(path, { method: "GET" });
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return await this.send<T>(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  }

  private async send<T>(path: string, init: RequestInit): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const raw = await response.text();
    let body: T;
    try {
      body = JSON.parse(raw) as T;
    } catch {
      throw new Error(`${init.method} ${path} вернул не JSON (${response.status}): ${raw.slice(0, 500)}`);
    }
    return { status: response.status, body, raw };
  }
}
```

### tests/e2e/tsconfig.json

```
{
  // Тот же базовый конфиг, что у сервисов (strict, NodeNext, ES2023) — этот
  // каталог компилируется корневым `npm run build`, чтобы сквозной тест
  // проверялся типами в CI, хотя запускается отдельной командой
  // (`npm run test:e2e`, см. stack.test.ts).
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    // `fetch`/`RequestInit` приходят из @types/node (глобалы undici) —
    // отдельный lib "DOM" тесту не нужен и притащил бы браузерные типы.
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["dist"]
}
```

