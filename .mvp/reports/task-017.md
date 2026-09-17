# Task 017 — пилотный контент-пакет `courses/pilot-sql/` — отчёт

## Что создано

- `courses/pilot-sql/manifest.yaml` — курс `id: pilot-sql`, `version: 1.0.0`,
  2 модуля, 7 уроков, 1 песочница (`id: main`, `type: postgres`).
- `courses/pilot-sql/lessons/*.md` (7 файлов) — Markdown-текст каждого
  урока, на русском.
- `courses/pilot-sql/sandbox/seed.sql` — одна таблица `books` (5 столбцов) +
  5 стартовых строк; DDL и данные в одном файле (единственный `seed`,
  указанный в манифесте).
- `courses/README.md` — формат контент-пакета для будущих авторов курсов
  (структура каталога, обязательные правила `manifest.yaml` дословно по
  `manifest.schema.json`/`validate.ts` из задачи 006/фикс-раундов), ссылка
  на `pilot-sql` как эталон.
- Удалён `courses/.gitkeep` (каталог больше не пуст).

## Структура курса (для 018/019 — smoke-тест/установщик)

- `intro` (Введение в SQL): `what-is-sql` (только content), `select-basics`
  (content + quiz, 1 верный / 2 неверных варианта с `explanation`),
  `practice-instock` (content + practice **без** `check` — самоотметка,
  задание "выбрать книги в наличии").
- `filtering` (Фильтрация и изменение данных): `where-clause` (content +
  quiz), `practice-add-book` (content + practice **с** `check` — INSERT,
  check: `select count(*) = 1 as ok from books where title = 'Мастер и
  Маргарита' and author = 'Михаил Булгаков'`), `practice-update-stock`
  (content + practice **с** `check` — UPDATE, check: `select in_stock =
  false as ok from books where id = 1`), `wrap-up` (только content).
- Все id (курс/модуль/урок/sandbox/вариант квиза) уникальны на своём
  уровне, урок — глобально по курсу; module/lesson id используют только
  `[A-Za-z0-9._-]`, начиная с буквы/цифры (URL/id-safe, как требует схема
  006/фикс-раундов).
- Каждый check-запрос — контракт "одна строка, один boolean" — проверен
  вживую (см. ниже), не только по форме текста.

## Верификация — реальный вывод

- `node --input-type=module` со `scanCoursesDir('./courses')` (реальный,
  собранный `services/backend/dist/courses/loader.js`, не собственная
  логика) — курс `pilot-sql` принят, `rejected: []`.
- `loadCoursePackage('./courses/pilot-sql')` — `ok: true`, все 7 уроков
  прочитаны с `content`, структура модулей/квизов/практики — как описано
  выше (точный per-lesson дамп снят и совпал с ожиданием).
- Одноразовый `postgres:17-alpine` в Docker: `sandbox/seed.sql` применяется
  без ошибок (5 строк книг); практический сценарий `practice-add-book`
  (INSERT нужной книги → check) и `practice-update-stock` (UPDATE `id=1` →
  check) оба дали check-результат `t` (true) — контракт "одна строка, один
  boolean" подтверждён на реальном Postgres, не только по тексту SQL.
- `bash .mvp/ci-mirror.sh` — код `0`: `npm ci` → lint (backend+frontend) →
  build → test (backend 217/217, 0 skip — одноразовый Postgres ci-mirror
  поднялся; frontend 43/43 vitest). Новых тестов не добавлял — задача
  контентная, не кодовая; существующий тест-сьют не менялся и не задет.
- `node scripts/check-text-sources.mjs` — код `0` (новые файлы — валидный
  UTF-8 текст, гейт не-текстовых байт не сработал).

## Интерфейсный дайджест для задач 018/019

- Курс для smoke-теста/установщика: `courseId = "pilot-sql"`,
  `sandboxId = "main"` (единственная песочница — можно не указывать
  `sandboxId` в вызовах, где он опционален).
- Пример "self-check" урока (без `check`): `lessonId =
  "practice-instock"` — прогоняется одной пользовательской SQL-попыткой
  и самоотметкой.
- Пример урока с автоматической проверкой: `lessonId =
  "practice-add-book"` (INSERT) или `"practice-update-stock"` (UPDATE) —
  оба содержат `practice.check`, возвращающий `true` после корректного
  запроса пользователя (запросы см. выше или в `manifest.yaml`).
- Пример урока с квизом: `lessonId = "select-basics"`, верный вариант
  `id: "select"`; `lessonId = "where-clause"`, верный вариант
  `id: "filter"`.
- Курс пройден полностью = пройдены все 7 уроков (нет отдельного
  "финального" урока с особой семантикой — `wrap-up` обычный content-урок).

## Deferred decisions

- **Язык контента — русский.** Продукт (`docs/product/business-logic.md`,
  весь UI-текст в отчётах предыдущих задач) на русском; явного требования
  на язык пилотного курса брифом не задано, выбрал согласованный с
  остальным продуктом язык.
- **Один общий `seed.sql` (DDL + данные), а не два файла.** Список файлов
  в брифе называет ровно `courses/pilot-sql/sandbox/seed.sql` (единственное
  число) — не стал заводить `01-schema.sql`/`02-data.sql`, как в
  синтетических тестовых фикстурах задачи 008 (там несколько файлов
  демонстрировали многофайловый seed как таковой; здесь бриф явно назвал
  один файл).
- **Тема курса — SQL на примере таблицы книг (`books`).** Бриф/продуктовые
  доки называют тему только как «пилот для обкатки платформы» /
  практика на SQL (`docs/product/business-logic.md`); конкретный домен
  (книги, а не сотрудники/заказы) — самостоятельный выбор, ничего в ядре
  или тестах от него не зависит (ядро специальность-агностично).
- **7 уроков / 2 модуля, смесь content-only, content+quiz, content+practice
  (с check и без)** — выбрано так, чтобы пилотный курс реально
  демонстрировал весь функционал формата (квиз, self-check практика,
  practice с check), а не был вырожденным одноурочным примером.

## Concerns

Нет — `DONE`, не `DONE_WITH_CONCERNS`: контент-пакет валиден по реальному
валидатору, seed и оба check-запроса проверены на живом Postgres, полный
`ci-mirror.sh` зелёный.

## Fix round (review findings)

Оба финдинга — **fixed**, `courses/pilot-sql/manifest.yaml` (единственный
файл в границе, единственный изменённый файл этого раунда).

- **minor, строка 62 (`practice-add-book` check).** Подтверждено чтением
  `manifest.yaml`: `check` проверял только `title`/`author`, хотя промпт
  урока (строка 61) явно требует `published_year = 1967, in_stock = true`
  — строка с верным названием/автором, но неверным годом или статусом
  наличия, проходила проверку. Исправлено — check теперь требует
  совпадения всех четырёх полей:
  `select count(*) = 1 as ok from books where title = 'Мастер и
  Маргарита' and author = 'Михаил Булгаков' and published_year = 1967
  and in_stock = true`.

- **bug, строка 69 (`practice-update-stock` check).** Подтверждено чтением
  `services/backend/src/practice/check.ts` (`runPracticeCheck`: `rows.length
  !== 1` → `throw violation(...)`, kind `check_contract_violation`) и
  `services/backend/src/routes/practice.ts` (`isPracticeCheckError(err)` →
  `reply.code(422)`, "Broken check query — course content, not a failed
  attempt"). Исходный check `select in_stock = false as ok from books
  where id = 1` возвращает ноль строк, если строки с `id = 1` больше нет —
  а песочница персистентна на весь сеанс курса и пользователь имеет полный
  SQL-доступ (не только SELECT), так что `delete from books where id = 1`
  на любом более раннем шаге делает этот check структурно битым: ученик
  получит 422 "сломанный контент курса" вместо честного pass/fail.
  Исправлено по образцу соседнего `practice-add-book` — паттерн
  `count(*) = 1`, устойчивый к отсутствию строки:
  `select count(*) = 1 as ok from books where id = 1 and in_stock =
  false`.

Проверено:
- `grep` по всему репозиторию (кроме `.mvp/review/*`,
  `.mvp/reports/task-017.md` — цитаты ревью/отчёта, не код) — на точный
  текст исходных check-запросов ссылок из тестов/фикстур нет, изменение
  безопасно.
- `bash .mvp/ci-mirror.sh` — код `0` (первый прогон упал на старте
  одноразового Postgres в докере — инфраструктурная флакиность запуска
  контейнера, не связанная с правкой; повторный прогон сразу после этого
  прошёл зелёным: backend 217/217, frontend 43/43, lint/build без ошибок).
