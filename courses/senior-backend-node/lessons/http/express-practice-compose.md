# Практика: ядро Express — compose цепочки middleware

Написать движок цепочки middleware — классика live-coding: в маленькой
функции сходится всё, что нужно понимать про Express — порядок,
переключение в режим ошибки, остановка после ответа. Ты уже писал
похожую вещь для фронтовых задач; здесь — серверная семантика.

Движок не умеет передавать функции, поэтому middleware описаны
данными, а ты реализуешь сам конвейер.

## Задание

Экспортируй функцию `runChain(middlewares, requestName)`.

Каждый middleware — объект:

```ts
type Middleware =
  | { name: string; kind: "normal"; action: "next" | "respond" | "throw" }
  | { name: string; kind: "error"; action: "handle" | "pass" };
```

Семантика — как в Express:

- Цепочка выполняется по порядку. Пока ошибки нет, выполняются только
  `kind: "normal"`; обработчики ошибок (`kind: "error"`) пропускаются
  молча.
- Обычный middleware при выполнении пишет в журнал своё `name`, затем:
  - `next` — управление идёт дальше;
  - `respond` — формируется ответ `handled:<name>`, цепочка
    останавливается;
  - `throw` — возникает ошибка с именем этого middleware; цепочка
    переходит в режим ошибки.
- В режиме ошибки обычные middleware пропускаются молча, выполняются
  только `kind: "error"`. Такой обработчик пишет в журнал `name!`
  (с восклицательным знаком), затем:
  - `handle` — формируется ответ `error:<errName>:handled-by:<name>`,
    где `<errName>` — имя middleware, породившего ошибку; цепочка
    останавливается;
  - `pass` — ошибка передаётся дальше по цепочке (аналог `next(err)`).
- Дошли до конца в режиме ошибки — ответ `unhandled:<errName>`.
- Дошли до конца без ответа и без ошибки — ответ `404`.

Функция возвращает:

```ts
type Outcome = { request: string; log: string[]; response: string };
```

`request` — просто эхо аргумента `requestName` (чтобы случаи читались).

Заготовка:

```ts
type Middleware =
  | { name: string; kind: "normal"; action: "next" | "respond" | "throw" }
  | { name: string; kind: "error"; action: "handle" | "pass" };

type Outcome = { request: string; log: string[]; response: string };

export function runChain(middlewares: Middleware[], requestName: string): Outcome {
  // ...
  return { request: requestName, log: [], response: "404" };
}
```

## Пример

```json
[
  { "name": "logger", "kind": "normal", "action": "next" },
  { "name": "auth",   "kind": "normal", "action": "throw" },
  { "name": "route",  "kind": "normal", "action": "respond" },
  { "name": "errors", "kind": "error",  "action": "handle" }
]
```

Результат: журнал `["logger", "auth", "errors!"]`, ответ
`error:auth:handled-by:errors`. Обрати внимание: `route` в журнал не
попал — в режиме ошибки обычные middleware пропускаются.

## Ловушки, которые проверяют случаи

- Обработчик ошибок до места ошибки не выполняется вовсе (Express
  выполняет цепочку по порядку, а не ищет обработчики по всему списку
  назад).
- `respond` останавливает цепочку: всё, что после, не выполняется и не
  логируется.
- `pass` передаёт ошибку следующему обработчику ошибок, не меняя её
  имени.
- Ошибка без единого обработчика — `unhandled:<errName>`.
- Пустая цепочка — `404`.
