// Два лаунчера — один контракт.
//
// scripts/start.ps1 (Windows) и scripts/start.sh (macOS/Linux) обязаны
// существовать по отдельности: скрипт запуска работает до того, как поднято
// хоть что-то, и не может полагаться ни на что, кроме встроенного в систему,
// а требовать ради него Node нельзя — пользователю ставится только Docker.
//
// Цена этого — два места, которые расходятся молча. Тест ловит именно
// молчаливое расхождение: не «тексты совпадают дословно» (они и не должны —
// команды и пути разные), а «числа и имена, от которых зависит поведение,
// одинаковы». Правка таймаута или имени сервиса в одном файле без второго
// роняет этот тест, а не пользовательский запуск на чужой ОС.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ps1 = readFileSync(join(scriptsDir, "start.ps1"), "utf8");
const sh = readFileSync(join(scriptsDir, "start.sh"), "utf8");

/** Значение переменной в PowerShell: `$Name = 123` / `$Name    = 123`. */
function psValue(name) {
  const match = new RegExp(`\\$${name}\\s*=\\s*([^\\s#]+)`).exec(ps1);
  assert.ok(match !== null, `в start.ps1 не найдена переменная $${name}`);
  return match[1];
}

/** Значение переменной в sh: `NAME=123`. */
function shValue(name) {
  const match = new RegExp(`^${name}=([^\\s#]+)`, "m").exec(sh);
  assert.ok(match !== null, `в start.sh не найдена переменная ${name}`);
  return match[1];
}

void test("таймауты ожидания в обоих лаунчерах одинаковы", () => {
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

void test("оба лаунчера проходят одни и те же пять шагов", () => {
  assert.equal(psValue("totalSteps"), shValue("TOTAL_STEPS"));
  // Заголовки шагов — то, что видит пользователь; они должны совпадать
  // дословно, иначе инструкция, написанная для одной ОС, перестаёт
  // описывать другую.
  const steps = [
    "Проверяю Docker",
    "Проверяю настройки (файл .env)",
    "Собираю и запускаю платформу",
    "Жду, пока платформа будет готова",
    "Готово",
  ];
  for (const step of steps) {
    assert.ok(ps1.includes(step), `start.ps1 не содержит шаг «${step}»`);
    assert.ok(sh.includes(step), `start.sh не содержит шаг «${step}»`);
  }
});

void test("оба лаунчера ждут одни и те же сервисы под одними и теми же названиями", () => {
  for (const [service, title] of [
    ["postgres", "База данных"],
    ["backend", "Ядро платформы"],
    ["frontend", "Интерфейс"],
  ]) {
    for (const [name, source] of [
      ["start.ps1", ps1],
      ["start.sh", sh],
    ]) {
      assert.ok(source.includes(service), `${name} не упоминает сервис ${service}`);
      assert.ok(source.includes(title), `${name} не называет «${title}»`);
    }
  }
});

void test("оба лаунчера требуют одни и те же ключи .env и один и тот же алфавит паролей", () => {
  for (const key of ["POSTGRES_PASSWORD", "APP_DB_PASSWORD", "SANDBOX_DB_PASSWORD"]) {
    assert.ok(ps1.includes(key), `start.ps1 не проверяет ${key}`);
    assert.ok(sh.includes(key), `start.sh не проверяет ${key}`);
  }
  // Пароль уезжает в postgres://... — набор допустимых символов обязан
  // совпадать, иначе сгенерированный на одной ОС .env ломает запуск на
  // другой.
  const charset = "[A-Za-z0-9._~-]";
  assert.ok(ps1.includes(charset), "start.ps1 не проверяет алфавит паролей");
  assert.ok(sh.includes(charset.replace("]", "]")), "start.sh не проверяет алфавит паролей");
  assert.ok(ps1.includes("trellis_pgdata"), "start.ps1 не проверяет том базы");
  assert.ok(sh.includes("trellis_pgdata"), "start.sh не проверяет том базы");
});

void test("оба лаунчера одинаково распознают обрыв связи с реестром образов", () => {
  // Один и тот же список признаков сетевого сбоя: от него зависит, будет
  // ли автоматический повтор и запуск на ранее собранных образах.
  for (const marker of ["failed to do request", "registry-1", "dial tcp", "no such host", "TLS handshake", "i/o timeout"]) {
    assert.ok(ps1.includes(marker), `start.ps1 не распознаёт «${marker}»`);
    assert.ok(sh.includes(marker), `start.sh не распознаёт «${marker}»`);
  }
});

void test("оба лаунчера умеют синхронизацию паролей и называют её в подсказке", () => {
  assert.match(ps1, /-SyncPasswords/);
  assert.match(sh, /--sync-passwords/);
  // Подсказка «как починить» выдаётся в одной и той же ситуации.
  for (const source of [ps1, sh]) {
    assert.ok(source.includes("password authentication failed"));
    assert.ok(source.includes("ALTER ROLE trellis_app WITH PASSWORD"));
  }
});
