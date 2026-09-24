# Практика: circuit breaker как конечный автомат

Пишем предохранитель из прошлого урока: скользящее окно исходов,
порог с минимумом наблюдений, Open с таймером, Half-Open с пробами.
Задача на аккуратность переходов — и один из самых частых
«напишите» после самого вопроса про breaker.

## Модель

Время модельное, события приходят снаружи:

```ts
type Config = {
  windowSize: number;      // окно: последние N завершённых вызовов (в Closed)
  failureThreshold: number;// доля отказов (0..1), при >= которой размыкаемся
  minCalls: number;        // минимум вызовов в окне, раньше не судим
  openMs: number;          // сколько держим Open до Half-Open
  halfOpenProbes: number;  // сколько проб пропускаем в Half-Open
};

type Event = { at: number; result: "success" | "failure" };
```

## Задание

Экспортируй функцию `runBreaker(config, events)` — прогоняет события
(попытки вызова) по порядку и возвращает журнал решений.

Правила:

- Состояния: `closed` (начальное), `open`, `half-open`.
- **Closed**: вызов выполняется, исход попадает в скользящее окно
  (держи последние `windowSize` исходов). После добавления: если в
  окне ≥ `minCalls` вызовов и доля отказов ≥ `failureThreshold` —
  переход в `open` (момент перехода — `at` этого события). Журнал:
  `"exec:<result>"`, при переходе дополнительно `"->open"`.
- **Open**: если `at < момент_открытия + openMs` — вызов отклоняется:
  журнал `"reject"`. Иначе — переход в `half-open` (журнал
  `"->half-open"`), и событие обрабатывается уже по правилам
  Half-Open.
- **Half-Open**: пропускается не больше `halfOpenProbes` проб.
  Проба выполняется: `"probe:<result>"`. Отказ пробы — немедленно
  `open` (новый таймер от этого `at`, журнал `"->open"`). Если все
  `halfOpenProbes` проб успешны — `closed` с **пустым окном**
  (журнал `"->closed"`). События сверх лимита проб, пока решение не
  принято, отклоняются: `"reject"`.
- Верни `{ log: string[]; finalState: string }`.

Заготовка:

```ts
type Config = {
  windowSize: number;
  failureThreshold: number;
  minCalls: number;
  openMs: number;
  halfOpenProbes: number;
};
type Event = { at: number; result: "success" | "failure" };

export function runBreaker(config: Config, events: Event[]): { log: string[]; finalState: string } {
  // ...
  return { log: [], finalState: "closed" };
}
```

## Пример

Конфиг: окно 4, порог 0.6, минимум 4, open 1000 мс, проб 2.

```json
[
  { "at": 0,    "result": "success" },
  { "at": 10,   "result": "failure" },
  { "at": 20,   "result": "failure" },
  { "at": 30,   "result": "success" },
  { "at": 40,   "result": "failure" },
  { "at": 50,   "result": "success" },
  { "at": 1100, "result": "success" },
  { "at": 1200, "result": "success" },
  { "at": 1300, "result": "success" }
]
```

Журнал: `["exec:success", "exec:failure", "exec:failure",
"exec:success", "exec:failure", "->open", "reject", "->half-open",
"probe:success", "probe:success", "->closed", "exec:success"]`,
финальное состояние `closed`.

Разбор: к моменту 40 окно из последних четырёх — failure, failure,
success, failure — 3/4 ≥ 0.6 → open (в момент 30 доля была 2/4 —
ниже порога). В 50 — reject. В 1100 таймер
вышел: half-open, prob-а успешна; в 1200 вторая — цепь замкнулась с
чистым окном; 1300 — обычный вызов.

## Ловушки, которые проверяют случаи

- До `minCalls` вызовов цепь не размыкается, какой бы ни была доля.
- Окно скользящее: старые исходы вытесняются, размыкает доля
  **последних** windowSize.
- Отказ пробы в half-open — сразу open с новым таймером; последующие
  до его истечения — reject.
- После закрытия окно пустое: старые отказы не тянутся за цепью.
- Событие ровно в момент `открытие + openMs` — уже half-open.
