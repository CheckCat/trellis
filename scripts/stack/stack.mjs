#!/usr/bin/env node
// `npm start`, `npm run stack:rebuild`, `npm run stack:down` — управление
// платформой на любой ОС.
//
// Это ДИСПЕТЧЕР, а не четвёртая реализация: он только выбирает лаунчер по
// системе, переводит ключи в принятый там вид и передаёт управление вместе
// с кодом возврата. Логики запуска здесь нет и быть не должно — иначе
// появился бы ещё один источник правды в дополнение к двум, которые и так
// приходится держать синхронными (scripts/stack/*.ps1 и scripts/stack/*.sh).
//
// Почему лаунчеры не написаны на Node, раз он тут всё равно есть: npm-скрипты
// — удобство для разработчика, у которого Node уже стоит. Конечному
// пользователю ставится только Docker Desktop, и скрипты запуска обязаны
// работать без Node — сама платформа его не требует, Node живёт внутри
// образов (см. services/*/Dockerfile).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));

/**
 * Команды и их ключи. Один и тот же ключ в sh и в PowerShell выглядит
 * по-разному (`--sync-passwords` против `-SyncPasswords`), и перевод —
 * единственное, что этот файл знает про содержимое лаунчеров.
 */
const COMMANDS = {
  start: {
    summary: "поднять платформу (обычный запуск)",
    flags: { "--sync-passwords": "-SyncPasswords" },
  },
  rebuild: {
    summary: "пересобрать образы начисто по текущему коду и поднять заново; данные сохраняются",
    flags: { "--sync-passwords": "-SyncPasswords" },
  },
  down: {
    summary: "остановить и удалить контейнеры; данные сохраняются",
    flags: { "--with-data": "-WithData", "--yes": "-Yes", "-y": "-Yes" },
  },
};

function printUsage(stream) {
  stream.write("Управление локальной платформой Trellis.\n\n");
  stream.write("  npm start                              — " + COMMANDS.start.summary + "\n");
  stream.write("  npm run stack:rebuild                  — " + COMMANDS.rebuild.summary + "\n");
  stream.write("  npm run stack:down                     — " + COMMANDS.down.summary + "\n");
  stream.write("  npm run stack:down -- --with-data      — то же плюс удалить данные (спросит подтверждение)\n");
  stream.write("  npm start -- --sync-passwords          — привести пароли ролей в базе к .env\n\n");
  stream.write("Без Node то же самое делают сами лаунчеры:\n");
  stream.write("  Windows:      scripts\\stack\\start.bat, rebuild.bat, down.bat (двойной щелчок)\n");
  stream.write("  macOS/Linux:  ./scripts/stack/start.sh, rebuild.sh, down.sh\n");
}

/** Чем и что запускать на этой системе. */
function launcher(command, args) {
  const spec = COMMANDS[command];
  if (process.platform === "win32") {
    // PowerShell 7+ когда есть, иначе Windows PowerShell 5.1 — тот же
    // выбор, что делает scripts/stack/_run.bat для двойного щелчка.
    // -ExecutionPolicy Bypass: политика по умолчанию не даёт выполнить
    // неподписанный локальный .ps1, а проект не подписан. Применяется
    // только к этому запуску.
    const translated = args.map((arg) => spec.flags[arg] ?? arg);
    const psArgs = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(scriptsDir, `${command}.ps1`),
      ...translated,
    ];
    return {
      script: join(scriptsDir, `${command}.ps1`),
      command: "pwsh",
      args: psArgs,
      fallback: { script: join(scriptsDir, `${command}.ps1`), command: "powershell", args: psArgs },
    };
  }
  const script = join(scriptsDir, `${command}.sh`);
  return { script, command: "sh", args: [script, ...args] };
}

function run({ command, args, fallback }) {
  const child = spawn(command, args, { stdio: "inherit" });

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
    // Код возврата лаунчера — это ответ на вопрос «получилось ли»; обёртка
    // обязана его пробросить, иначе CI и скрипты сочтут успехом любой исход.
    process.exitCode = signal !== null ? 1 : (code ?? 1);
  });
}

const [commandName, ...commandArgs] = process.argv.slice(2);

if (commandName === undefined || commandName === "--help" || commandName === "-h") {
  printUsage(commandName === undefined ? process.stderr : process.stdout);
  process.exitCode = commandName === undefined ? 2 : 0;
} else if (!Object.hasOwn(COMMANDS, commandName)) {
  process.stderr.write(`Неизвестная команда: ${commandName}\n\n`);
  printUsage(process.stderr);
  process.exitCode = 2;
} else {
  const chosen = launcher(commandName, commandArgs);
  if (!existsSync(chosen.script)) {
    process.stderr.write(`Лаунчер не найден: ${chosen.script}\n`);
    process.exitCode = 1;
  } else {
    run(chosen);
  }
}
