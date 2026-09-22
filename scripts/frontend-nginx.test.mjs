// Инварианты того, как nginx отдаёт собранный фронтенд.
//
// Оба проверяемых здесь правила — не вкусовщина: нарушение каждого из них
// ломает приложение у пользователя молча, и оба уже ломали.
//
// --- 1. CSP против CodeMirror ---
//
// Редактор практики живёт за счёт стилей, которые вставляются в страницу в
// рантайме.
//
// CodeMirror 6 не поставляет свой CSS файлом. Он собирает его на лету и
// вставляет в <head> отдельным <style> (механизм StyleModule из библиотеки
// style-mod). Для CSP это «inline style element», и директива
// `style-src 'self'` без `'unsafe-inline'` его блокирует: тег в DOM есть,
// но его `.sheet` равен null, и ни одно правило не применяется.
//
// Последствие не косметическое. Без своего CSS блок номеров строк
// (`.cm-gutters`, который должен быть абсолютно спозиционирован слева и
// занимать ~30px) растекается на всю ширину редактора и ложится поверх
// `.cm-content` — клик по редактору не попадает в contenteditable, фокус
// уходит в body, набрать запрос физически невозможно. То есть строгий
// style-src ломает не вид практики, а саму практику.
//
// Поймать это было нечем: vite dev-сервер такой заголовок не шлёт (в
// `npm run dev` редактор рабочий), jsdom в vitest CSP не применяет, а
// сквозной tests/e2e/stack.test.ts ходит по HTTP API и браузер не
// открывает. Баг воспроизводился только в собранном стеке — ровно там, где
// его встречает ученик. Этот тест — замена того наблюдения: он не
// открывает браузер, но падает, если кто-то вернёт style-src в состояние,
// при котором редактор снова умрёт молча.
//
// Тест намеренно проверяет только style-src. Остальные директивы CSP
// ужесточать можно и нужно — ограничение ровно одно и оно здесь названо.
//
// --- 2. index.html не должен кешироваться ---
//
// Приложение обновляется пересборкой образов (`npm run stack:rebuild`), а
// имена бандлов Vite содержат хеш содержимого. Значит новый index.html
// ссылается на новые файлы, а старых в новом образе уже нет.
//
// Если index.html отдаётся без Cache-Control (только с ETag/Last-Modified,
// как делает nginx по умолчанию), браузер применяет к нему эвристическое
// кеширование и переиспользует старую страницу, не спрашивая сервер. Для
// пользователя это выглядит как «обновил — ничего не изменилось» в лучшем
// случае и как пустой экран в худшем: страница из кеша просит бандлы,
// которых больше нет. Заодно из кеша приезжают и старые заголовки — именно
// на этом ровно один раз попался фикс CSP выше: правка уже была в образе, а
// страница продолжала работать под прежней политикой.
//
// Ассеты с хешем в имени кешировать было бы можно, но приложение целиком
// локальное — выигрыш на loopback нулевой, а отдельный location для них
// стоил бы дорого из-за подводного камня nginx, который сторожит третий
// тест: add_header внутри location отменяет ВСЕ унаследованные add_header,
// то есть тихо снял бы с ассетов заголовки безопасности.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const nginxConf = readFileSync(join(repoRoot, "services/frontend/nginx.conf"), "utf8");

/**
 * Достаёт значение одной директивы из заголовка Content-Security-Policy,
 * как он записан в nginx.conf (внутри двойных кавычек после add_header).
 */
function cspDirective(name) {
  const header = nginxConf.match(/add_header\s+Content-Security-Policy\s+"([^"]+)"/);
  assert.ok(header, "в services/frontend/nginx.conf не найден заголовок Content-Security-Policy");

  const directive = header[1]
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

  return directive === undefined ? undefined : directive.slice(name.length).trim();
}

test("style-src разрешает стили, которые CodeMirror вставляет в рантайме", () => {
  const styleSrc = cspDirective("style-src");
  assert.ok(styleSrc !== undefined, "директива style-src исчезла из CSP — тогда действует default-src, и он тоже должен разрешать inline-стили");

  // Либо 'unsafe-inline', либо nonce/hash — важно не какой именно способ
  // выбран, а что вставленный в рантайме <style> не будет заблокирован.
  const allowsRuntimeStyles =
    styleSrc.includes("'unsafe-inline'") || styleSrc.includes("'nonce-") || styleSrc.includes("'sha256-");

  assert.ok(
    allowsRuntimeStyles,
    `style-src сейчас "${styleSrc}" — CodeMirror под этим заголовком не сможет вставить свой CSS, и SQL-редактор практики перестанет принимать ввод (см. комментарий в начале файла)`,
  );
});

test("style-src не превращён в полностью открытый", () => {
  const styleSrc = cspDirective("style-src");

  // Послабление касается только inline-стилей. Тянуть CSS с чужих хостов
  // приложению незачем: оно целиком локальное.
  assert.ok(!styleSrc.includes("*"), `style-src не должен содержать подстановку: "${styleSrc}"`);
  assert.ok(
    styleSrc.includes("'self'"),
    `style-src обязан оставить 'self' для собственного бандла стилей: "${styleSrc}"`,
  );
});

test("script-src остался строгим", () => {
  // Послабление для стилей не должно за компанию расползтись на скрипты:
  // курс — сторонний контент-пакет, и выполнение кода из него запрещено
  // инвариантом проекта.
  const scriptSrc = cspDirective("script-src");
  assert.equal(scriptSrc, "'self'", "script-src обязан остаться строго 'self'");
});

test("страница не кешируется браузером между пересборками", () => {
  const cacheControl = nginxConf.match(/add_header\s+Cache-Control\s+"([^"]+)"/);
  assert.ok(
    cacheControl,
    "в services/frontend/nginx.conf нет add_header Cache-Control — браузер начнёт кешировать index.html эвристически и после обновления покажет старое приложение (см. комментарий в начале файла)",
  );

  const value = cacheControl[1];
  assert.ok(
    value.includes("no-cache") || value.includes("no-store") || value.includes("max-age=0"),
    `Cache-Control сейчас "${value}" — он обязан заставлять браузер перепроверять страницу на сервере`,
  );
});

test("ни один location не перебивает заголовки уровня server", () => {
  // Подводный камень nginx: add_header не складывается, а замещает. Как
  // только внутри location появляется хоть один add_header, ВСЕ add_header
  // родительского уровня для этого location перестают действовать — то есть
  // ответы по этому пути молча уезжают без CSP, без nosniff и без
  // Cache-Control. Этот тест не запрещает add_header в location, он
  // требует, чтобы такой location перечислил заголовки заново.
  const locationBlocks = [...nginxConf.matchAll(/location\s+([^{]+)\{([^}]*)\}/g)];

  for (const [, path, body] of locationBlocks) {
    if (!/add_header/.test(body)) continue;

    for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Cache-Control"]) {
      assert.ok(
        body.includes(header),
        `location ${path.trim()} объявляет свой add_header, но не повторяет ${header} — из-за замещающей семантики add_header в nginx ответы по этому пути уйдут без него`,
      );
    }
  }
});
