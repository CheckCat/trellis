# Практика кода (`practice.type: code`, Node/TypeScript) — дизайн

Дата: 2026-09-23. Статус: утверждён в обсуждении, ожидает ревью текста.

## Цель

Третий тип практики рядом с `sql` и `answer`: ученик пишет функцию на
TypeScript или JavaScript в браузере, движок исполняет её на своей стороне
на объявленных курсом входах и засчитывает урок по декларативным данным
манифеста. Первый и пока единственный рантайм — Node. Языковая ось заложена
(`language`), но доработки под другие языки не делаются.

Что должно получиться для автора курса: задание описывается в `manifest.yaml`
теми же средствами, что SQL-задание — входы, эталон (явный или через
`solution`), без единой строки авторского тест-кода. Для ученика: редактор,
кнопка «Выполнить», таблица «вход → мой результат → вердикт», зачёт урока
по всем случаям.

## Решения, принятые в обсуждении

1. **Механика — функция + `cases` + `solution`**, а не программа со
   stdin/stdout. Возвращаемые значения сравниваются структурно, вывод в
   консоль показывается, но не сравнивается. Причина: сравнение текста
   хрупко (пробелы, переводы строк), а инвариант проекта запрещает
   авторский код-грейдер — значит эталон должен быть данными или решением.
2. **Исполнение — дочерний процесс `node` внутри backend-контейнера**, не
   отдельный контейнер и не `worker_threads`. Изоляция процессная (таймаут,
   лимит памяти, пустой `env`, временный `cwd`, лимит вывода), не
   security-граница: код видит файловую систему и сеть контейнера. Модель
   угроз — локальный ученик запускает свой код на своей машине, то же, что
   `node file.ts` в терминале. Симметрично Postgres-песочнице (отдельная
   роль в том же инстансе, не отдельный сервис). Docker-compose не меняется.
3. **Без нового типа песочницы.** `SANDBOX_TYPES` не расширяется, курс не
   объявляет `sandboxes[]` ради кода. `SandboxDriver` (`provision(seed)`,
   «одна живая песочница на процесс», `withFreshSandbox`) описывает
   накапливающее состояние, которого у кода нет: каждый запуск — новый
   процесс с нуля. Раннер живёт внутри плагина `plugins/practice/code/`.
   Язык — свойство задания, не курса.
4. **TypeScript без транспилятора.** Раннер запускает
   `node --experimental-strip-types`. Локально Node 22.16 (флаг существует
   с 22.6), в образе `node:22-alpine` — 22.23 (включено по умолчанию, флаг
   безвреден). Ноль новых зависимостей backend. Следствие: поддерживается
   только «стираемый» TS — `enum`, `namespace`, parameter properties и
   прочие конструкции с рантайм-семантикой отклоняются самим Node; типы не
   проверяются, только стираются. Оба ограничения — часть контракта
   (capabilities + документация автора).

## Манифест

```yaml
practice:
  type: code                 # обязателен (как у answer; умолчание type — sql)
  language: typescript       # обязателен: typescript | javascript
  prompt: "Напишите функцию sum(a, b), возвращающую сумму."
  entry: sum                 # имя именованного ESM-экспорта
  starter: |                 # необязателен; стартовое содержимое редактора
    export function sum(a: number, b: number): number {
      // ...
    }
  cases:                     # обязателен; 1..maxCodeCases
    - args: [2, 3]
      expected: 5            # эталон явно…
    - args: [-1, 1]          # …или через solution
  solution: |                # необязателен
    export function sum(a: number, b: number) { return a + b; }
```

Поля (все — в `CODE_PRACTICE.manifestFields` в `capabilities.ts`, откуда
валидатор выводит «чужие» поля других типов):

| Поле | Тип | Обязательно | Правило |
|---|---|---|---|
| `type` | string | да | ровно `"code"` |
| `language` | string | да | одно из `CODE_LANGUAGES = ["typescript", "javascript"]` |
| `prompt` | string | да | как у остальных типов |
| `entry` | string | да | идентификатор JS: `^[A-Za-z_$][A-Za-z0-9_$]*$`, не `default` |
| `starter` | string | нет | уходит клиенту как есть |
| `cases` | object[] | да | `minItems: 1`, `maxItems: MAX_CODE_CASES` |
| `cases[].args` | array | да | массив произвольных JSON-значений (аргументы вызова по порядку) |
| `cases[].expected` | any JSON | нет* | *обязателен у каждого case, если `solution` отсутствует; `null` — допустимое значение, отсутствие поля ≠ `null` |
| `solution` | string | нет | код автора на том же `language`, с тем же `entry` |

Семантические ошибки валидатора (`courses/validate/validate.ts`, каждая с
manifest-путём):

- `practice.language` отсутствует / не из списка;
- `practice.entry` не идентификатор;
- `practice.cases` пуст;
- `practice.cases[i].args` не массив;
- `practice.cases[i].expected` отсутствует при отсутствующем `solution`;
- чужие поля (`sandbox`, `check`, `fields`, …) — как сейчас, через
  `PRACTICE_FIELD_OWNERS`.

JSON Schema (`courses/manifest.schema.json`): `type` enum пополняется
`code`; добавляются `language` (enum), `entry`, `starter`, `cases`
(`items: { required: [args], properties: { args: {type: array}, expected: {} } }`),
`solution` уже есть у `sql` — у `code` то же имя и тот же тип `string`, поэтому
оно попадает в `PRACTICE_FIELD_OWNERS` с двумя владельцами (это уже
поддерживается: `owners.push`). `capabilities.test.ts` сверяет enum'ы схемы
с реестром без правок.

Доменный тип (`courses/types.ts`):

```ts
export interface CourseCodeCase {
  readonly args: readonly unknown[];
  /**
   * Откуда берётся эталон этого case. Нормализовано валидатором из
   * «есть ли ключ expected в манифесте» (проверка `in`, не `!== undefined`:
   * YAML не выражает undefined, а `expected: null` — законное значение).
   * Явный дискриминатор вместо optional-поля, чтобы остальной код не
   * гадал, значит ли отсутствие `expected` «эталон из solution».
   */
  readonly reference: { readonly kind: "expected"; readonly value: unknown } | { readonly kind: "solution" };
}
export interface CourseCodePractice {
  readonly type: "code";
  readonly language: CodeLanguage;
  readonly prompt: string;
  readonly entry: string;
  readonly starter?: string;
  readonly cases: readonly CourseCodeCase[];
  readonly solution?: string;
}
export type CoursePractice = CourseSqlPractice | CourseAnswerPractice | CourseCodePractice;
```

## Реестр возможностей (`capabilities.ts`)

- `PRACTICE_TYPES = ["sql", "answer", "code"]`; новый `CODE_LANGUAGES` +
  `CodeLanguage`.
- `CODE_PRACTICE: PracticeTypeCapability` — `requiresSandbox: false`,
  `submitPath: "practice/code"`, поля из таблицы выше, одна механика:
  `{ name: "cases", manifestFields: ["cases", "solution"], … }`. Поскольку
  `cases` обязателен, `isGraded` в `progress/model` всегда отвечает
  `practice` — код-задание без зачёта не существует по построению.
- Лимиты (импортируются из модулей плагина, как у SQL):
  `codeTimeoutSeconds` (10), `codeMemoryMb` (256), `maxCodeLength` (50 000
  символов, тело запроса), `maxCodeCases` (50), `maxCodeOutputChars`
  (16 384 — захваченный `console.*` на один case; общий stdout/stderr
  процесса — 65 536).
- `docs/contracts/capabilities.json` перегенерируется
  (`npm run capabilities:write`).

## Плагин `plugins/practice/code/`

Плоская папка (правило раунда 2: папка плагина — уже единица группировки):

| Файл | Ответственность |
|---|---|
| `index.ts` | `export { codePracticeStrategy } from "./route.js"` |
| `route.ts` | `POST /courses/:courseId/lessons/:lessonId/practice/code`: JSON-схемы тела и ответа, `resolvePractice(…, "code")`, вызов `runCodePracticeAttempt`, маппинг ошибок на 200/422/503, `markLessonCompleted`, `toLessonCompletionPayload` |
| `run-code.ts` | оркестрация попытки без HTTP: `runCodePracticeAttempt(runner, practice, code, context)` — сначала `solution` (если есть), затем код ученика, затем сравнение по case'ам; `evaluateCodePracticeAttempt` |
| `run-node.ts` | `NodeRunner`: `mkdtemp` → запись harness/модуля/`cases.json` → `spawn` → сбор `result.json`/stdout/stderr/exit → `finally` удаление папки. Интерфейс `CodeRunner` + `createNodeRunner()` — чтобы `route`/`run-code` тестировались со скриптованным раннером |
| `harness.ts` | текст harness-модуля как строковая константа (ESM `.mjs`), см. протокол ниже |
| `compare.ts` | нормализация значений в переносимую форму и структурное сравнение |
| `errors.ts` | `PracticeSolutionError`-аналог для кода (`kind: "solution_failed"`), `isCodeSolutionError` |
| `*.test.ts` | по тесту на модуль + `code.test.ts` HTTP-уровня через `withPracticeApp` |

`registry.ts`: `code: codePracticeStrategy`. `plugins/practice/index.ts`
и `api.ts` не меняются.

### Протокол harness

Harness — статический `harness.mjs`, получает через `argv`: путь к модулю
ученика, имя `entry`, путь к `cases.json`, путь к `result.json`, лимит
вывода на case. Порядок:

1. `await import(modulePath)`. Неудача (синтаксис, исключение верхнего
   уровня) → `result.json = { kind: "load_failed", error: {message, stack} }`,
   выход 0.
2. `mod[entry]` отсутствует или не функция →
   `{ kind: "entry_missing", exported: string[] }` (имена экспортов — чтобы
   ученик увидел «вы экспортировали `Sum`, нужен `sum`»).
3. Для каждого case по порядку: подменить `console.log/info/warn/error/debug`
   на буфер этого case (обрезка по лимиту с пометкой `truncated`); вызвать
   `entry(...args)`; `await` результат (поддержка `Promise`); результат
   → `encode()`; исключение → `{ error: {message, stack} }`.
   Итог: `{ kind: "ran", cases: [{ value?, error?, output, truncated }] }`.
4. Исключения самого harness (например, ошибка сериализации циклической
   структуры) → per-case `error` с текстом «результат не сериализуется в
   JSON», не падение процесса.

`encode()` переносит значения, которые JSON теряет:
`undefined → {"$undefined": true}`, `NaN → {"$nan": true}`,
`±Infinity → {"$inf": 1|-1}`, `bigint → {"$bigint": "…"}`, `Date` — по
`toISOString` в `{"$date": …}`, `Map/Set` — в `{"$map": [[k,v]]}` /
`{"$set": […]}`. Обычные объекты/массивы/строки/числа/булевы/`null` — как
есть. Эталон `expected` из манифеста — уже JSON, кодируется тем же
`encode()` на стороне backend, так что обе стороны сравнения — в одной форме.

### Раннер (`run-node.ts`)

```
spawn(process.execPath, [
  "--experimental-strip-types",
  "--no-warnings=ExperimentalWarning",
  `--max-old-space-size=${CODE_MEMORY_MB}`,
  "--disallow-code-generation-from-strings",
  harnessPath, modulePath, entry, casesPath, resultPath, String(MAX_CODE_OUTPUT_CHARS),
], { cwd: tmpDir, env: {}, stdio: ["ignore", "pipe", "pipe"] })
```

- Расширение модуля: `.mts` для `typescript`, `.mjs` для `javascript` —
  ESM без угадывания по содержимому.
- Таймаут `CODE_TIMEOUT_SECONDS` на весь процесс → `SIGKILL` → результат
  `{ kind: "timeout", cases: <частичный снимок> }`. Per-case таймаута нет:
  один зависший case и так проваливает попытку. Чтобы ученик всё же узнал,
  на каком case процесс завис, harness перезаписывает `result.json` целиком
  после каждого завершённого case (атомарно: запись во временное имя +
  `rename`); после `SIGKILL` backend читает последний снимок, если он есть.
- Вывод процесса (stdout/stderr суммарно) — буфер до 64 КБ, дальше
  обрезка; используется только когда `result.json` не появился (падение
  Node, OOM — `Node` печатает `FATAL ERROR … heap out of memory` в stderr)
  → `{ kind: "crashed", exitCode, signal, stderr }`.
- `node` не запустился вовсе (`spawn` → `ENOENT`/`EACCES`) →
  `{ kind: "unavailable", message }` → 503.
- Temp-папка: `fs.mkdtemp(path.join(os.tmpdir(), "trellis-code-"))`, всегда
  удаляется в `finally` (`rm -rf`). В образе процесс идёт от пользователя
  `node`, `/tmp` доступен на запись — проверяется в плане отдельным шагом.

### Оркестрация (`run-code.ts`)

1. Если `solution` есть — `runner.run({ language, code: solution, entry, cases })`.
   Любой исход, кроме `ran` без per-case `error`, → `CodeSolutionError`
   (422, «сломанный курс», в сообщении — kind и слова Node; текст решения
   не уходит). Эталон каждого case: `expected`, если задан, иначе `value`
   из прогона solution (на одном case и то и другое — приоритет у
   `expected`; линт-правило на «оба заданы» не заводим).
2. Прогон кода ученика тем же раннером.
3. Итог `CodePracticeAttemptResult`:
   - `ran: { kind: "ran" | "load_failed" | "entry_missing" | "timeout" | "crashed", … }`
   - `cases: [{ args, passed: boolean, value?, error?, output, truncated }]`
     — заполняется только при `kind: "ran"`; при `timeout` — по частичному
     снимку, недобежавшие case'ы помечаются `passed: false` без `value`;
   - `allPassed`.

Порядок «эталон до ученика» здесь не необходим технически (процессы
раздельны), но сохраняется как единое правило движка.

### Маршрут и ответ

Тело: `{ code: string }` — `minLength: 1`, `pattern: "\\S"`,
`maxLength: MAX_CODE_LENGTH` (те же правила, что у `sql`).

Ответ 200:

```ts
{
  ok: boolean;                       // kind === "ran"
  failure?: {                        // только при !ok
    kind: "load_failed" | "entry_missing" | "timeout" | "crashed";
    message: string;                 // слова Node как есть / список экспортов / «превышено N с»
  };
  durationMs: number;
  cases: Array<{
    args: unknown[];                 // вход — публичен
    passed: boolean;
    value?: unknown;                 // СОБСТВЕННЫЙ результат ученика в encode-форме
    error?: { message: string };     // исключение ученика в этом case
    output: string;                  // console.* этого case
    truncated: boolean;
  }>;
  passed: boolean;                   // все case
  lesson, course                     // как у остальных write-маршрутов
}
```

Что не уходит никогда: `expected`, `solution`, значение эталона при
провале. Причина провала для ученика — «результат не совпал» на строке
case; сравнить он может только с условием задачи. Маршрута раскрытия
ответа нет (как у `sql`; исключение по-прежнему только у `answer`).

Статусы: 400 (схема), 404/409 (`resolvePractice`), 422
(`CodeSolutionError` — `{ error: "solution_failed", message }`), 503
(`kind: "unavailable"` — `{ error: "unavailable", message }`).

Зачёт: `passed && lessonCompletionMode(lesson) === "practice"` →
`markLessonCompleted` (идемпотентно, односторонне).

## Остальной backend (компилятор укажет каждое место)

- `routes/courses/courses.ts`'s `toPublicPractice`: ветка `code` →
  `{ type, prompt, language, entry, starter? }`; `publicPracticeSchema`
  пополняется.
- `lint/skills/skills.ts`: `VERIFY_KINDS` + `"code"`; `skills.schema.json`
  enum; `lint/course/course.ts`: `VERIFY_MECHANICS.code = { practiceType: "code", mechanic: "cases" }`,
  `describeActualVerification` → `"code"`; `lessonVisibleText` — `prompt`
  уже включён, `starter` не текст для ученика в смысле терминов (код), не
  добавляется; `checkStrictGrading` — как есть (`type !== "sql"` → skip).
- `lint/features/features.ts`: анализатора для `code` нет — тип «просто
  не проверяется» (документировано в файле), `practice-uses-untaught` для
  него не срабатывает.
- `progress/model`: без правок (реестр).
- `extensibility.test.ts`: без правок — проверить, что проходит.

## Frontend

- `shared/api/types.ts`: `PublicCodePractice`, `PracticeCodeResponse`
  (+ `PublicPractice` расширяется). `shared/api/client.ts`:
  `runPracticeCode(courseId, lessonId, code)`.
- Зависимость: `@codemirror/lang-javascript` (единственная новая в
  проекте; `javascript({ typescript: language === "typescript" })`).
- `features/practice/code-editor/{index.tsx, code-editor.tsx, code-editor.test.tsx}`
  — по образцу `sql-editor/`.
- `features/practice/use-code-practice.ts` — по образцу `use-practice.ts`
  (мутация + инвалидация `courseProgress` при `passed`).
- `features/practice/code-practice-view/{index.tsx, code-practice-view.tsx, code-practice-view.test.tsx}`:
  prompt → редактор (черновик через `draft.ts` с тем же ключом урока;
  при пустом черновике — `starter`) → кнопка «Выполнить» → при `!ok`
  блок `failure` (моноширинный, как `PracticeSqlErrorView`) → таблица
  case'ов: вход (`JSON.stringify(args)` через обратный `decode` маркеров),
  результат/ошибка, вывод консоли (свёрнутый, если пуст), вердикт → строка
  «Все случаи пройдены» / «Пройдено k из n».
- `PracticeView`: третья ветка `case "code"`.

## Тесты

Backend:
- `compare.test.ts`: примитивы, порядок ключей, порядок массива, `null` vs
  `undefined`, `NaN`, `Infinity`, вложенные структуры, `Date`.
- `run-node.test.ts` (реальный `spawn`): успех TS и JS, async-функция,
  исключение в case, `load_failed` на синтаксисе, `entry_missing` со
  списком экспортов, `timeout` на `while (true)` с частичным снимком,
  `console.log` захвачен и обрезан, temp-папка удалена после каждого
  исхода, `env` пуст (`process.env.HOME` в коде ученика — `undefined`).
- `run-code.test.ts` (скриптованный раннер): эталон из `expected`, из
  `solution`, приоритет `expected`, `CodeSolutionError` на каждом плохом
  исходе solution, частичный timeout → недобежавшие case'ы провалены.
- `code.test.ts` (HTTP, `withPracticeApp` + скриптованный раннер): 200 с
  зачётом и `lesson.completedAt`, 200 без зачёта, 409 на `sql`-урок, 422 на
  сломанное solution, 503 на `unavailable`, схема тела (`\\S`,
  `maxLength`), ответ не содержит `expected`/`solution` (проверка по
  сериализованному телу).
- `validate.test.ts`: каждое семантическое правило выше; чужие поля;
  `solution` с двумя владельцами.
- `capabilities.test.ts`, `extensibility.test.ts`, `course.rules.test.ts`:
  без изменений — зелёные.

Frontend: `code-editor.test.tsx` (ввод, `busy`), `code-practice-view.test.tsx`
(starter при пустом черновике, отправка, рендер таблицы и `failure`,
«Пройдено k из n»).

Инфраструктура: ручной запуск в собранном стеке (`npm start`) с уроком
`code` — `/tmp` пишется от `node`, strip-types в образе работает.

## Документация

- `.mvp/invariants.md`: механика `cases` в списке; новый инвариант «код
  практики исполняется дочерним процессом `node` с таймаутом/лимитами;
  изоляция процессная, не security-граница; эталон снимается до ученика».
- `docs/product/analysis-grey-zones.md`: решения 2–4 из этого документа.
- `CLAUDE.md` (проект): абзац про типы практики — третий тип и его
  механика; путь плагина.
- `courses/README.md`: раздел про `type: code` с примером.
- `.claude/skills/practice-code/SKILL.md` — по образцу `practice-answer`.
- `courses/pilot-sql` не трогается. Ручная проверка в собранном стеке —
  одноразовым курсом в `courses/` на время проверки (каталог смонтирован в
  backend), в репозиторий он не коммитится; автоматические тесты используют
  синтетические фикстуры `courses/test-support.ts`.

## Вне объёма

- Другие языки/рантаймы; несколько файлов в решении; зависимости из npm в
  коде ученика; per-case таймауты; «показать ответ» для кода; кэширование
  результата `solution`; линт-анализатор возможностей языка
  (`practice-uses-untaught` для JS/TS); публичные/скрытые case'ы.
