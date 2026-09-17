# Review: task 017

## Commits (ca809067e2c36408022cb50bb5bec9d401483943..HEAD)


## Diffstat (ca809067e2c36408022cb50bb5bec9d401483943 -> working tree)

 .mvp/ledger.md   | 2 ++
 courses/.gitkeep | 0
 2 files changed, 2 insertions(+)

## Diff (ca809067e2c36408022cb50bb5bec9d401483943 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index e0cf182..41c9519 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -25,3 +25,5 @@ Task 014: complete (31e2e2876d579e40265a4417e62170f356968294)
   concern (task 015): review split: 4 finding(s) came from a minority of 3 polls — the others approved
   concern (task 015): review finding refuted, not fixed: {"severity":"bug","file":"services/frontend/src/features/practice/PracticeView.tsx","line":862,"quote":"<SqlEditor value={sql} onChange={setSql} onRun={() => run(sql)} busy={isRunning} />","summary":"Run/reset race on the mutation observer.","verdict":"REFUTED"}
 Task 015: complete (0af55cb5ba75a1fc44c9eacae7292769a1e08fd7)
+  concern (task 016): review split: 1 finding(s) came from a minority of 3 polls — the others approved
+Task 016: complete (ca809067e2c36408022cb50bb5bec9d401483943)
diff --git a/courses/.gitkeep b/courses/.gitkeep
deleted file mode 100644
index e69de29..0000000
```

## Untracked files (new, not yet added)

### courses/README.md

```
# Курсы

Каждый подкаталог здесь — один самостоятельный контент-пакет курса. Ядро
Trellis (`services/backend`) сканирует эту директорию при старте и по
явному запросу (`POST /courses/rescan`), проверяет каждый пакет по схеме
и показывает пользователю только те, что прошли проверку — сломанный
пакет не мешает остальным курсам работать (см. `docs/architecture.md`,
`.mvp/invariants.md`).

`courses/pilot-sql/` — пилотный курс «Основы SQL», собранный по этому
формату целиком (манифест, уроки, квиз, seed песочницы, практика с
check-запросом и без него) — используйте его как образец при добавлении
нового курса.

## Структура пакета курса

```
courses/<course-id>/
  manifest.yaml       # метаданные курса, структура модулей/уроков, квизы,
                       # практика, объявленные песочницы — см. ниже
  lessons/*.md         # текст уроков, на которые ссылается manifest.yaml
  sandbox/*.sql         # seed-скрипты объявленных песочниц (DDL + данные)
```

Пути к файлам урока (`lessons[].content`) и seed-файлам
(`sandboxes[].seed[]`) в `manifest.yaml` — относительные, отсчитываются от
корня пакета (`courses/<course-id>/`). Абсолютные пути, `..` и симлинки,
уводящие за пределы пакета, отклоняются при валидации.

## manifest.yaml — обязательные правила

- `id` курса — стабильный, используется как ключ реестра и в записях
  прогресса; формат: строчные латинские буквы/цифры/дефис, от 2 до 64
  символов, не начинается с дефиса (`^[a-z0-9][a-z0-9-]{1,63}$`).
- `version` — строка в формате semver (`1.0.0`, допустимы `-pre`/`+build`
  суффиксы).
- `title` — обязателен, не может состоять из одних пробелов.
- `modules` — минимум один модуль; у каждого модуля минимум один урок.
- `id` модуля и урока — стабильны (не индекс, не название — на них
  завязан прогресс пользователя и URL API), формат:
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. `id` урока уникален **по всему
  курсу**, а не только внутри своего модуля.
- Урок несёт хотя бы одно из: `content` (путь к Markdown-файлу), `quiz`,
  `practice` — можно любую комбинацию сразу.
- `quiz.options` — минимум 2 варианта, ровно один с `correct: true`;
  у каждого варианта **кроме верного** обязательно поле `explanation`
  (почему он неверный — показывается пользователю после ответа).
- `practice.sandbox` обязан ссылаться на `id` одной из `sandboxes`,
  объявленных этим же курсом.
- `practice.check` — необязателен. Если есть, это ровно один SQL-запрос,
  который после попытки пользователя выполняется от роли песочницы и
  обязан вернуть **одну строку с одним boolean-столбцом**
  (`true`/`false` — зачтено или нет). Никакой другой логики зачёта ядро
  не поддерживает. Задание без `check` засчитывается самоотметкой
  пользователя.
- `sandboxes[].type` — на данный момент только `"postgres"`.
  `sandboxes[].seed` — список путей к `.sql`-файлам, выполняются по
  порядку от роли песочницы (никогда от роли приложения) при подключении
  курса и при каждом сбросе песочницы; вместе они должны пересоздавать
  всё, что нужно для практики курса с нуля (DDL + данные).

Полная схема (структурные правила, которые проверяет ядро до показа
курса пользователю) — `services/backend/src/courses/manifest.schema.json`.
```

### courses/pilot-sql/lessons/practice-add-book.md

```
# Практика: добавить книгу

Чтобы добавить новую строку в таблицу, используется `INSERT INTO`:

```sql
insert into books (title, author, published_year, in_stock)
values ('Название', 'Автор', 2024, true);
```

Добавьте в таблицу `books` книгу «Мастер и Маргарита» Михаила Булгакова,
изданную в 1967 году, которая сейчас есть в наличии.

Это задание проверяется автоматически: после того как вы выполните
запрос, движок курса проверит, что нужная строка появилась в таблице.
```

### courses/pilot-sql/lessons/practice-instock.md

```
# Практика: книги в наличии

Пора написать первый самостоятельный запрос. В таблице `books` каждая
книга помечена столбцом `in_stock`: `true`, если она сейчас есть в
наличии, `false` — если нет.

Откройте редактор ниже и напишите запрос, который выбирает **название**
(`title`) и **автора** (`author`) только тех книг, у которых `in_stock`
равен `true`.

Это задание не проверяется автоматически — когда результат вас устроит,
отметьте урок пройденным самостоятельно.
```

### courses/pilot-sql/lessons/practice-update-stock.md

```
# Практика: обновить статус книги

Чтобы изменить уже существующие строки, используется `UPDATE` вместе с
`WHERE` — без `WHERE` изменятся *все* строки таблицы, поэтому условие
здесь особенно важно:

```sql
update books set in_stock = false where id = 3;
```

Книга «Война и мир» (`id = 1`) сейчас числится в наличии. Обновите
таблицу `books` так, чтобы у этой книги `in_stock` стал `false`.

Это задание проверяется автоматически: движок курса проверит, что у
книги с `id = 1` значение `in_stock` действительно стало `false`.
```

### courses/pilot-sql/lessons/select-basics.md

```
# SELECT: выбираем данные

Чтобы прочитать данные из таблицы, используется команда `SELECT`. Самый
простой вариант — выбрать все столбцы всех строк:

```sql
select * from books;
```

Звёздочка `*` означает «все столбцы». Обычно удобнее явно перечислить,
какие столбцы нужны — тогда результат проще читать:

```sql
select title, author from books;
```

Этот запрос вернёт только название и автора каждой книги, без `id`,
`published_year` и `in_stock`.

Порядок столбцов в результате — тот же, в котором вы их перечислили после
`select`. Порядок строк без дополнительных указаний не гарантирован — если
он важен, для этого есть `order by` (в этом курсе не рассматривается).
```

### courses/pilot-sql/lessons/what-is-sql.md

```
# Что такое SQL

SQL (Structured Query Language, «язык структурированных запросов») — это
язык, на котором мы разговариваем с реляционной базой данных: просим её
показать, добавить, изменить или удалить данные.

Данные в реляционной базе хранятся в **таблицах**. У таблицы есть
**столбцы** (какие свойства есть у каждой записи) и **строки** (сами
записи). Например, таблица `books` из этого курса хранит книги: у каждой
книги есть название, автор, год издания и признак того, есть ли она сейчас
в наличии.

| id | title             | author        | published_year | in_stock |
|----|-------------------|---------------|-----------------|----------|
| 1  | Война и мир       | Лев Толстой   | 1869             | true     |
| 2  | ...               | ...           | ...              | ...      |

В следующих уроках вы научитесь читать данные из такой таблицы (`SELECT`),
отбирать только нужные строки (`WHERE`) и изменять данные (`INSERT`,
`UPDATE`) — на примере именно этой таблицы книг, прямо в браузере, в
редакторе внутри урока.
```

### courses/pilot-sql/lessons/where-clause.md

```
# WHERE: фильтруем строки

`SELECT` без условий возвращает все строки таблицы. Чтобы оставить только
нужные, после списка столбцов и имени таблицы добавляют `WHERE` с
условием:

```sql
select title, author from books where in_stock = true;
```

Такой запрос вернёт только книги, у которых `in_stock` равен `true` —
остальные строки в результат не попадут.

Условия можно комбинировать через `and`/`or`, сравнивать числа (`<`, `>`,
`=`), а не только логические значения:

```sql
select title from books where published_year < 1850;
```

`WHERE` работает одинаково и в `SELECT` (какие строки показать), и в
`UPDATE`/`DELETE` (какие строки изменить или удалить) — в следующих уроках
вы это увидите на практике.
```

### courses/pilot-sql/lessons/wrap-up.md

```
# Что дальше

В этом коротком курсе вы:

- узнали, что такое SQL и как устроена таблица (строки и столбцы);
- прочитали данные через `SELECT`, в том числе с отбором конкретных
  столбцов;
- отфильтровали строки условием `WHERE`;
- изменили данные через `INSERT` и `UPDATE`.

Этого достаточно, чтобы начать самостоятельно исследовать любую другую
таблицу тем же способом: `select * from <таблица>;`, затем сузить запрос
нужными столбцами и условием.

Курс пройден полностью, когда пройден каждый его урок — квизом (верный
ответ) или практикой (автоматическая проверка либо самоотметка), либо
явной отметкой «пройдено» для уроков без квиза и практики, как этот.
```

### courses/pilot-sql/manifest.yaml

```
id: pilot-sql
version: 1.0.0
title: "Основы SQL: работа с таблицей книг"
description: "Пилотный курс для обкатки платформы: SELECT, WHERE и изменение данных на примере небольшой таблицы книг."
sandboxes:
  - id: main
    type: postgres
    seed:
      - sandbox/seed.sql
modules:
  - id: intro
    title: "Введение в SQL"
    lessons:
      - id: what-is-sql
        title: "Что такое SQL"
        content: lessons/what-is-sql.md
      - id: select-basics
        title: "SELECT: выбираем данные"
        content: lessons/select-basics.md
        quiz:
          question: "Какая команда SQL используется, чтобы получить (выбрать) данные из таблицы?"
          options:
            - id: select
              text: "SELECT"
              correct: true
            - id: insert
              text: "INSERT"
              explanation: "INSERT используется, чтобы добавить новые строки в таблицу, а не прочитать существующие."
            - id: delete
              text: "DELETE"
              explanation: "DELETE используется, чтобы удалить строки из таблицы, а не прочитать их."
      - id: practice-instock
        title: "Практика: книги в наличии"
        content: lessons/practice-instock.md
        practice:
          sandbox: main
          prompt: "Напишите запрос, который выбирает название (title) и автора (author) всех книг, которые сейчас есть в наличии (in_stock = true)."
  - id: filtering
    title: "Фильтрация и изменение данных"
    lessons:
      - id: where-clause
        title: "WHERE: фильтруем строки"
        content: lessons/where-clause.md
        quiz:
          question: "Что делает условие в запросе SELECT * FROM books WHERE in_stock = true;?"
          options:
            - id: filter
              text: "Оставляет в результате только строки, где in_stock равно true"
              correct: true
            - id: sort
              text: "Сортирует результат по полю in_stock"
              explanation: "За сортировку отвечает ORDER BY, а не WHERE — WHERE не меняет порядок строк, а отбирает их."
            - id: no-effect
              text: "Ничего не меняет — WHERE работает только в INSERT и UPDATE"
              explanation: "WHERE точно так же работает и в SELECT: он ограничивает набор возвращаемых строк по условию."
      - id: practice-add-book
        title: "Практика: добавить книгу"
        content: lessons/practice-add-book.md
        practice:
          sandbox: main
          prompt: "Добавьте в таблицу books новую книгу: title = 'Мастер и Маргарита', author = 'Михаил Булгаков', published_year = 1967, in_stock = true."
          check: "select count(*) = 1 as ok from books where title = 'Мастер и Маргарита' and author = 'Михаил Булгаков' and published_year = 1967 and in_stock = true"
      - id: practice-update-stock
        title: "Практика: обновить статус книги"
        content: lessons/practice-update-stock.md
        practice:
          sandbox: main
          prompt: "Отметьте книгу с id = 1 («Война и мир») как отсутствующую в продаже: обновите in_stock на false."
          check: "select count(*) = 1 as ok from books where id = 1 and in_stock = false"
      - id: wrap-up
        title: "Что дальше"
        content: lessons/wrap-up.md
```

### courses/pilot-sql/sandbox/seed.sql

```
-- Пилотный курс "Основы SQL" — данные песочницы.
-- Выполняется от sandbox-роли при подключении курса и при каждом сбросе
-- песочницы (core-инвариант: seed- и check-запросы курса, как и запросы
-- пользователя, идут только от роли песочницы, никогда от роли приложения).
--
-- Одна небольшая таблица books — её достаточно, чтобы пройти весь пилотный
-- курс (SELECT, WHERE, INSERT, UPDATE) без лишней сложности.

create table books (
    id serial primary key,
    title text not null,
    author text not null,
    published_year integer not null,
    in_stock boolean not null default true
);

insert into books (title, author, published_year, in_stock) values
    ('Война и мир', 'Лев Толстой', 1869, true),
    ('Преступление и наказание', 'Фёдор Достоевский', 1866, true),
    ('Отцы и дети', 'Иван Тургенев', 1862, false),
    ('Евгений Онегин', 'Александр Пушкин', 1833, true),
    ('Мёртвые души', 'Николай Гоголь', 1842, false);
```

