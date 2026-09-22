// Два лаунчера — один контракт.
//
// scripts/stack/*.ps1 (Windows) и scripts/stack/*.sh (macOS/Linux) обязаны
// существовать по отдельности: скрипт запуска работает до того, как поднято
// хоть что-то, и не может полагаться ни на что, кроме встроенного в систему,
// а требовать ради него Node нельзя — пользователю ставится только Docker.
//
// Цена этого — два места, которые расходятся молча. Тест ловит именно
// молчаливое расхождение: не «тексты совпадают дословно» (они и не должны —
// команды и пути разные), а «числа, шаги и имена, от которых зависит
// поведение, одинаковы». Правка таймаута или шага в одном файле без второго
// роняет этот тест, а не пользовательский запуск на чужой ОС.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const stackDir = join(dirname(fileURLToPath(import.meta.url)), "stack");
const read = (name) => readFileSync(join(stackDir, name), "utf8");

/** Команды лаунчера. Каждая обязана существовать в трёх видах. */
const COMMANDS = ["start", "rebuild", "down"];

const commonPs1 = read("common.ps1");
const commonSh = read("common.sh");
const ps1 = Object.fromEntries(COMMANDS.map((name) => [name, read(`${name}.ps1`)]));
const sh = Object.fromEntries(COMMANDS.map((name) => [name, read(`${name}.sh`)]));

/** Значение переменной в PowerShell: `$Name = 123` / `$Name    = 123`. */
function psValue(name) {
  const match = new RegExp(`\\$${name}\\s*=\\s*([^\\s#]+)`).exec(commonPs1);
  assert.ok(match !== null, `в common.ps1 не найдена переменная $${name}`);
  return match[1];
}

/** Значение переменной в sh: `NAME=123`. */
function shValue(name) {
  const match = new RegExp(`^${name}=([^\\s#]+)`, "m").exec(commonSh);
  assert.ok(match !== null, `в common.sh не найдена переменная ${name}`);
  return match[1];
}

/** Шаги команды в том порядке, в котором их увидит пользователь. */
function stepsOfSh(source) {
  return [...source.matchAll(/^write_step (\d+) '([^']*)'/gm)].map((m) => `${m[1]}. ${m[2]}`);
}

function stepsOfPs1(source) {
  return [...source.matchAll(/^Write-Step -Number (\d+) -Text '([^']*)'/gm)].map((m) => `${m[1]}. ${m[2]}`);
}

/** Все значения, которые команда присваивает счётчику шагов. У down их два
 * (с удалением данных и без), у остальных — одно. */
function totalsOfSh(source) {
  return [...source.matchAll(/^\s*TOTAL_STEPS=(\d+)/gm)].map((m) => Number(m[1])).sort();
}

function totalsOfPs1(source) {
  const line = /^\$script:TotalSteps\s*=\s*(.+)$/m.exec(source);
  assert.ok(line !== null, "в .ps1 не найдено присваивание $script:TotalSteps");
  return [...line[1].matchAll(/\d+/g)].map((m) => Number(m[0])).sort();
}

void test("у каждой команды есть реализация под обе системы и вход для двойного щелчка", () => {
  for (const name of COMMANDS) {
    for (const file of [`${name}.sh`, `${name}.ps1`, `${name}.bat`]) {
      assert.ok(existsSync(join(stackDir, file)), `нет scripts/stack/${file}`);
    }
  }
});

void test("таймауты ожидания в общей части обоих лаунчеров одинаковы", () => {
  // Разъезд здесь — самый незаметный: на одной ОС пользователь получает
  // «не дождался» там, где на другой всё успевает подняться.
  const timeouts = [
    ["DockerStartTimeoutSeconds", "DOCKER_START_TIMEOUT_SECONDS"],
    ["PostgresTimeoutSeconds", "POSTGRES_TIMEOUT_SECONDS"],
    ["BackendTimeoutSeconds", "BACKEND_TIMEOUT_SECONDS"],
    ["FrontendTimeoutSeconds", "FRONTEND_TIMEOUT_SECONDS"],
  ];
  for (const [inPs1, inSh] of timeouts) {
    assert.equal(psValue(inPs1), shValue(inSh), `${inPs1} и ${inSh} разошлись`);
  }
});

void test("каждая команда проходит одни и те же шаги под одними и теми же заголовками", () => {
  // Заголовки шагов — то, что видит пользователь; они должны совпадать
  // дословно, иначе инструкция, написанная для одной ОС, перестаёт
  // описывать другую.
  for (const name of COMMANDS) {
    const stepsSh = stepsOfSh(sh[name]);
    const stepsPs1 = stepsOfPs1(ps1[name]);
    assert.ok(stepsSh.length > 0, `${name}.sh не объявляет ни одного шага`);
    assert.deepEqual(stepsPs1, stepsSh, `шаги ${name}.ps1 и ${name}.sh разошлись`);
    // Нумерация без дыр: «шаг 4 из 7», которого не существует, — это
    // баг, который видно только пользователю.
    assert.deepEqual(
      stepsSh.map((step) => Number(step.split(".")[0])),
      stepsSh.map((_, index) => index + 1),
      `нумерация шагов ${name} не подряд`,
    );
    assert.deepEqual(totalsOfPs1(ps1[name]), totalsOfSh(sh[name]), `число шагов ${name} разошлось`);
    assert.ok(
      totalsOfSh(sh[name]).includes(stepsSh.length),
      `${name}: объявленное число шагов не совпадает с их фактическим количеством`,
    );
  }
});

void test("оба лаунчера ждут одни и те же сервисы под одними и теми же названиями", () => {
  for (const [service, title] of [
    ["postgres", "База данных"],
    ["backend", "Ядро платформы"],
    ["frontend", "Интерфейс"],
  ]) {
    for (const [name, source] of [
      ["common.ps1", commonPs1],
      ["common.sh", commonSh],
    ]) {
      assert.ok(source.includes(service), `${name} не упоминает сервис ${service}`);
      assert.ok(source.includes(title), `${name} не называет «${title}»`);
    }
  }
});

void test("оба лаунчера требуют одни и те же ключи .env и один и тот же алфавит паролей", () => {
  for (const key of ["POSTGRES_PASSWORD", "APP_DB_PASSWORD", "SANDBOX_DB_PASSWORD"]) {
    assert.ok(commonPs1.includes(key), `common.ps1 не проверяет ${key}`);
    assert.ok(commonSh.includes(key), `common.sh не проверяет ${key}`);
  }
  // Пароль уезжает в postgres://... — набор допустимых символов обязан
  // совпадать, иначе сгенерированный на одной ОС .env ломает запуск на
  // другой.
  const charset = "[A-Za-z0-9._~-]";
  assert.ok(commonPs1.includes(charset), "common.ps1 не проверяет алфавит паролей");
  assert.ok(commonSh.includes(charset), "common.sh не проверяет алфавит паролей");
  assert.equal(psValue("DataVolume"), "'trellis_pgdata'");
  assert.equal(shValue("DATA_VOLUME"), "'trellis_pgdata'");
});

void test("оба лаунчера одинаково распознают обрыв связи с реестром образов", () => {
  // Один и тот же список признаков сетевого сбоя: от него зависит, будет
  // ли автоматический повтор и запуск на ранее собранных образах.
  for (const marker of ["failed to do request", "registry-1", "dial tcp", "no such host", "TLS handshake", "i/o timeout"]) {
    assert.ok(commonPs1.includes(marker), `common.ps1 не распознаёт «${marker}»`);
    assert.ok(commonSh.includes(marker), `common.sh не распознаёт «${marker}»`);
  }
});

void test("оба лаунчера умеют синхронизацию паролей и называют её в подсказке", () => {
  for (const name of ["start", "rebuild"]) {
    assert.match(ps1[name], /-SyncPasswords/, `${name}.ps1 не принимает -SyncPasswords`);
    assert.match(sh[name], /--sync-passwords/, `${name}.sh не принимает --sync-passwords`);
  }
  // Подсказка «как починить» выдаётся в одной и той же ситуации.
  for (const source of [commonPs1, commonSh]) {
    assert.ok(source.includes("password authentication failed"));
    assert.ok(source.includes("ALTER ROLE trellis_app WITH PASSWORD"));
  }
});

void test("пересборка в обеих реализациях идёт без кеша", () => {
  // Без --no-cache команда превращается в обычный запуск, и ровно та
  // проблема, ради которой её заводили (переиспользованный слой с
  // зависимостями после git pull), остаётся неисправленной — молча.
  assert.match(commonPs1, /'compose', 'build', '--no-cache'/);
  assert.match(commonSh, /compose build --no-cache/);
});

void test("ни один лаунчер не удаляет том вместе с контейнерами", () => {
  // `down -v` удаляет тома из объединённой модели compose — это
  // единственный способ снести прогресс ученика мимоходом, «заодно с
  // остановкой». Удаление данных обязано быть отдельным, явным и
  // подтверждённым действием (down --with-data / -WithData), поэтому
  // формы `-v` и `--volumes` в лаунчерах запрещены совсем.
  for (const [name, source] of [
    ["common.ps1", commonPs1],
    ["common.sh", commonSh],
    ...COMMANDS.map((command) => [`${command}.ps1`, ps1[command]]),
    ...COMMANDS.map((command) => [`${command}.sh`, sh[command]]),
  ]) {
    // Строки-комментарии отбрасываются: они про `down` без -v и говорят,
    // а речь тут о настоящем вызове — поэтому в строке обязан быть ещё и
    // `compose`.
    const code = source
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    assert.doesNotMatch(code, /compose[^\n]*\bdown\b[^\n]*(-v\b|--volumes)/, `${name} содержит down с удалением томов`);
  }
});

void test("удаление данных требует подтверждения словом в обеих реализациях", () => {
  for (const [name, source] of [
    ["down.ps1", ps1.down],
    ["down.sh", sh.down],
  ]) {
    assert.ok(source.includes("УДАЛИТЬ"), `${name} не требует подтверждения`);
    assert.ok(source.includes("DELETE"), `${name} не принимает латинское подтверждение`);
    assert.ok(source.includes("trellis_pgdata") || source.includes("DataVolume") || source.includes("DATA_VOLUME"));
  }
  assert.match(ps1.down, /-WithData/);
  assert.match(sh.down, /--with-data/);
});
