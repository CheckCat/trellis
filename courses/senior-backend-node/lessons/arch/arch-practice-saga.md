# Практика: оркестратор саги с компенсациями

Пишем ядро сага-оркестратора: выполнить шаги по порядку, при отказе —
компенсировать выполненное в обратном порядке, пережить отказ самой
компенсации. Классика live-coding по мотивам «оформления заказа».

## Модель

Шаги описаны данными; исходы предопределены (модель реального мира):

```ts
type Step = {
  name: string;
  action: "ok" | "fail" | "timeout";       // исход прямого действия
  compensation?: "ok" | "fail";            // исход компенсации (default "ok")
  compensable?: boolean;                   // default true; false — шаг без компенсации
};
```

`timeout` считается отказом (в реальности — по истечении срока
ожидания ответа шага).

## Задание

Экспортируй функцию `runSaga(steps)`:

- Выполняй шаги по порядку. Успех — в журнал `"do:<name>:ok"`;
  отказ — `"do:<name>:fail"` (или `"do:<name>:timeout"`), и сага
  переходит к компенсации.
- Компенсируются **только успешно выполненные** шаги, в **обратном**
  порядке. Шаг с `compensable: false` пропускается с записью
  `"skip-compensation:<name>"`.
- Компенсация с исходом ok — `"undo:<name>:ok"`. Компенсация с
  исходом fail — `"undo:<name>:fail"`; после **одного** повтора
  (`"undo:<name>:retry"`) она считается выполненной (модель «повтор
  помог»), и в журнал идёт `"undo:<name>:ok"`. Компенсации остальных
  шагов продолжаются в любом случае.
- Все шаги прошли — сага успешна.
- Верни:

```ts
type SagaResult = {
  status: "completed" | "compensated";
  log: string[];
  completedSteps: string[];   // успешно выполненные прямые шаги, по порядку
};

export function runSaga(steps: Step[]): SagaResult;
```

## Пример

```json
[
  { "name": "reserve",  "action": "ok" },
  { "name": "charge",   "action": "ok", "compensation": "fail" },
  { "name": "delivery", "action": "timeout" }
]
```

Результат:

```json
{
  "status": "compensated",
  "log": [
    "do:reserve:ok",
    "do:charge:ok",
    "do:delivery:timeout",
    "undo:charge:fail",
    "undo:charge:retry",
    "undo:charge:ok",
    "undo:reserve:ok"
  ],
  "completedSteps": ["reserve", "charge"]
}
```

Отказ доставки компенсировал оплату (со второй попытки) и резерв —
именно в этом порядке.

## Ловушки, которые проверяют случаи

- Отказ первого же шага — компенсировать нечего:
  `status: "compensated"`, в журнале только `do:...:fail`.
- Некомпенсируемый шаг в середине — `skip-compensation`, но соседи
  компенсируются.
- Все шаги ok — `completed`, никаких undo.
- Пустой список шагов — `completed` с пустыми журналами (вырожденный,
  но валидный случай).
- Упавшая компенсация не прерывает остальные компенсации.
