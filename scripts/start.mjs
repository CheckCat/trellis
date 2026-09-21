#!/usr/bin/env node
// `npm start` — запустить платформу на любой ОС.
//
// Это ДИСПЕТЧЕР, а не третья реализация: он только выбирает лаунчер по
// системе и передаёт ему управление вместе с аргументами и кодом возврата.
// Логики запуска здесь нет и быть не должно — иначе появился бы третий
// источник правды в дополнение к двум, которые и так приходится держать
// синхронными (scripts/start.ps1 и scripts/start.sh).
//
// Почему лаунчеры не написаны на Node, раз он тут всё равно есть: `npm
// start` — удобство для разработчика, у которого Node уже стоит. Конечному
// пользователю ставится только Docker Desktop, и скрипт запуска обязан
// работать без Node — сама платформа его не требует, Node живёт внутри
// образов (см. services/*/Dockerfile).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

/** Чем запускать лаунчер на этой системе. */
function launcher() {
  if (process.platform === "win32") {
    // PowerShell 7+ когда есть, иначе Windows PowerShell 5.1 — тот же
    // выбор, что делает scripts/start.bat для двойного щелчка.
    // -ExecutionPolicy Bypass: политика по умолчанию не даёт выполнить
    // неподписанный локальный .ps1, а проект не подписан. Применяется
    // только к этому запуску.
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(scriptsDir, "start.ps1")];
    return { command: "pwsh", args, fallback: { command: "powershell", args } };
  }
  return { command: "sh", args: [join(scriptsDir, "start.sh")] };
}

function run({ command, args, fallback }) {
  const child = spawn(command, [...args, ...process.argv.slice(2)], { stdio: "inherit" });

  child.on("error", (err) => {
    // ENOENT именно на pwsh — нормальная ситуация: PowerShell 7 ставят не
    // все. Любая другая ошибка запуска — настоящая, её видно как есть.
    if (fallback !== undefined && err.code === "ENOENT") {
      run(fallback);
      return;
    }
    process.stderr.write(`Не удалось запустить ${command}: ${err.message}\n`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    // Код возврата лаунчера — это ответ на вопрос «поднялось ли»; `npm
    // start` обязан его пробросить, иначе CI и обёртки сочтут успехом
    // любой исход.
    process.exitCode = signal !== null ? 1 : (code ?? 1);
  });
}

const chosen = launcher();
const scriptPath = chosen.args[chosen.args.length - 1];
if (!existsSync(scriptPath)) {
  process.stderr.write(`Лаунчер не найден: ${scriptPath}\n`);
  process.exitCode = 1;
} else {
  run(chosen);
}
