# Task 012 — покрыть тестами ядро backend — отчёт

## Контекст

К моменту старта этой задачи в `services/backend` уже было 210 backend-тестов
(0 skipped), написанных имплементерами задач 006–010 вместе с самой
реализацией — включая все пять областей из заголовка задачи:
`courses/validate.test.ts` (16), `progress/reconcile.test.ts` (10),
`sandbox/postgres-sandbox.test.ts` + `sandbox/provisioner.test.ts` +
`routes/sandbox.test.ts` (44 суммарно), `practice/check.test.ts` (7),
`transfer/export.test.ts` + `transfer/import.test.ts` +
`transfer/format.test.ts` + `routes/transfer.test.ts` (34 суммарно, включая
явный round-trip тест).

Поэтому эта задача — не написание тестов с нуля, а **аудит существующего
покрытия против пяти заявленных областей и закрытие реальных пробелов**, а не
дублирование того, что уже проверено (DRY/SRP — см. общие принципы). Новых
тестовых файлов под `services/backend/tests/` не заводил: в проекте нет такой
директории, все тесты co-located (`*.test.ts` рядом с реализацией) —
`files:` брифа здесь подсказка, а не контракт (Common Agent Principles,
Boundary respect), и следование существующему паттерну важнее.

## Найденные и закрытые пробелы (7 новых тестов, всё co-located)

### `src/courses/validate.test.ts` (+4) — валидация контент-пакета

Было: дубликаты **lesson id** проверялись, дубликаты **sandbox id**/
**module id**/**quiz option id** — нет, хотя код (`validate.ts`) детектирует
все четыре одинаковым паттерном (`seenIds`/`seenModuleIds`/`seenOptionIds`).
Также была проверка `".."`/абсолютного пути/несуществующего файла, но не
симлинк-эскейпа — а `resolveSafePath`'s собственный докстринг прямо называет
его целью защиты («symlinks that resolve outside the package directory... a
lexical ".." check alone can't catch a symlink escape»).

- `"validateManifest rejects a duplicate sandbox id (edge case, task 012)"`
- `"validateManifest rejects a duplicate module id (edge case, task 012)"`
- `"validateManifest rejects a duplicate quiz option id within the same quiz (edge case, task 012)"`
- `"validateManifest rejects a content path that escapes the package directory via a symlink (path safety, task 012)"`
  — создаёт файл вне temp package dir и симлинк на него внутри
  `lessons/escape.md`; ожидает отказ с сообщением про «outside the package
  directory».

### `src/progress/reconcile.test.ts` (+1) — согласование прогресса по стабильным id

`compareVersions`'s ветка сравнения pre-release тегов (`"1.0.0-alpha" <
"1.0.0"`, сравнение двух pre-release строк между собой) не была покрыта —
существующий regression-тест проверял только числовую (major.minor.patch)
часть semver-сравнения.

- `"reconcile sorts a pre-release version before its release, and falls back to a string compare between two pre-releases (regression, task 012)"`

### `src/practice/check.test.ts` (+2) — контракт check-запроса

`describeType()` в `check.ts` (используется для сообщения о нарушении
контракта «не boolean») различает `null`/`undefined`/массив/`Date`/прочее —
но существующие тесты проверяли только `string`/`null`/`number`. Ветки
«массив» и «timestamp» (оба дают `typeof === "object"`, различить их можно
только через `describeType`'s собственные `Array.isArray`/`instanceof Date`)
были нереализуемы через `typeof`-сравнение и потому не покрыты.

- `"runPracticeCheck describes a timestamp verdict as \"a timestamp\", not typeof's generic \"object\" (edge case, task 012)"`
- `"runPracticeCheck describes an array-typed verdict as \"an array\", not typeof's generic \"object\" (edge case, task 012)"`

## Области без изменений — почему

- **Изоляция sandbox-роли**: уже покрыта на всех уровнях, достижимых из этой
  границы: (1) unit-тесты `postgres-sandbox.test.ts`/`provisioner.test.ts`
  против мока-пула; (2) `routes/sandbox.test.ts` и
  `practice/testSupport.ts`'s `withPracticeApp` конструируют сервер с
  `pool: unusedCorePool()`/`poolThatMustNotBeUsed()` — poisoned app-pool,
  который **бросает** при любом обращении, так что практика/sandbox-роуты
  структурно доказано никогда не трогают app-role pool; (3) тест «schema name
  that isn't a plain identifier is refused instead of interpolated into SQL».
  Проверка настоящих Postgres-грантов sandbox-роли (что она физически не
  видит `core`) требует `TRELLIS_TEST_SANDBOX_DATABASE_URL` в `ci.yml`/
  `ci-mirror.sh` — оба файла вне `services/backend`, задокументированный
  concern отчёта 009 (задача не заведена, вне этой границы), проверено
  вручную (отчёт 009). Добавлять тест, который скипается без этой переменной,
  нельзя: `ci-mirror.sh` падает при `# skipped > 0`, когда БД поднята.
- **Round-trip экспорта/импорта**: уже есть явный тест "re-importing a
  machine's own export changes nothing (round trip)"
  (`transfer/import.test.ts`) плюс "POST /progress/import round-trips this
  machine's own export as a no-op" (`routes/transfer.test.ts`), плюс
  multi-course/installed-vs-not-installed/empty-machine сценарии. Реального
  пробела не нашёл.

## Проверки — реальный вывод

`bash .mvp/ci-mirror.sh` — код `0`, прогнан дважды подряд:
```
1..217
# tests 217
# pass 217
# fail 0
# skipped 0
```
Было 210 backend-тестов до этой задачи, стало 217 (+7). Frontend: `Tests 8
passed (8)` (не трогал, без изменений). `npx tsc -p tsconfig.test.json` — без
ошибок. `eslint .` (через `npm run lint` внутри ci-mirror.sh) — без замечаний.

### Границы

`git status`: изменения только в
`services/backend/src/courses/validate.test.ts`,
`services/backend/src/practice/check.test.ts`,
`services/backend/src/progress/reconcile.test.ts` — все внутри
`services/backend`. `.mvp/ledger.md`/`.mvp/briefs/task-012.md` изменены не
мной (пайплайн; см. прецедент — отчёт 010, Fix round 2, находка про
`plan.json`/`ledger.md` — REFUTED, тот же механизм). Новых файлов, кроме
правок трёх существующих тестовых, не создавал.

## Deferred decisions

- **Не заводил `services/backend/tests/` с `courses.test.ts`/
  `progress.test.ts`/`sandbox.test.ts`/`transfer.test.ts`**, как буквально
  назвал `files:` брифа. В проекте нет такой директории — все существующие
  тесты co-located; заведение параллельной иерархии тестов создало бы два
  разных места, где искать тест для одного модуля, без выигрыша (Common
  Agent Principles: «Read existing patterns before writing new code»,
  «файлы — подсказка, не контракт»).
- **Не пытался включить БД-тест на реальные права sandbox-роли** (см. раздел
  выше) — это потребовало бы правки `ci.yml`/`ci-mirror.sh`, вне `BOUNDARY`;
  ровно тот же вывод, что уже зафиксирован в отчёте 009 как concern.
