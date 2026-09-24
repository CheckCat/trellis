# Практика: проекция из потока событий

Пишем проектор: из потока доменных событий обращений строим плоскую
витрину «список обращений» — ту самую read-модель CQRS. Требования
собраны из всего курса: события приходят at-least-once (дубли) и
строго по порядку в рамках ключа, проектор обязан быть идемпотентным
и толерантным к неизвестному.

## Модель

События (каждое несёт `seq` — номер в журнале, растёт монотонно;
дубль доставки повторяет тот же `seq`):

```ts
type Ev =
  | { seq: number; type: "created"; caseId: number; topic: string }
  | { seq: number; type: "assigned"; caseId: number; operatorId: number }
  | { seq: number; type: "escalated"; caseId: number }
  | { seq: number; type: "resolved"; caseId: number }
  | { seq: number; type: "closed"; caseId: number }
  | { seq: number; type: string; caseId: number };  // будущие типы
```

## Задание

Экспортируй функцию `project(events)`:

- Витрина — по обращению: `{caseId, topic, status, assigneeId,
  priority, events}` где `events` — число применённых к нему событий.
- Правила применения: `created` — статус `open`, приоритет 1,
  `assigneeId` null; `assigned` — записать оператора, из `open`
  статус становится `in_progress`; `escalated` — приоритет +1;
  `resolved` / `closed` — статус.
- **Дубль** (`seq` уже применён) — пропустить молча, счётчик `events`
  не растёт.
- **Неизвестный тип** события — пропустить, но записать в
  `warnings`: `"unknown:<type>:seq<seq>"`. Проектор не падает на
  новом типе — это правило совместимости.
- Событие для обращения, у которого не было `created` (потерянное
  начало — витрина строится с середины журнала), — пропустить с
  предупреждением `"orphan:seq<seq>"`.
- Верни:

```ts
type View = {
  cases: Record<number, {
    topic: string; status: string; assigneeId: number | null;
    priority: number; events: number;
  }>;
  applied: number;      // применённых событий (без дублей/пропусков)
  warnings: string[];
};

export function project(events: Ev[]): View;
```

## Пример

```json
[
  { "seq": 1, "type": "created",  "caseId": 7, "topic": "card-blocked" },
  { "seq": 2, "type": "assigned", "caseId": 7, "operatorId": 3 },
  { "seq": 2, "type": "assigned", "caseId": 7, "operatorId": 3 },
  { "seq": 3, "type": "starred",  "caseId": 7 },
  { "seq": 4, "type": "resolved", "caseId": 9 }
]
```

Результат: обращение 7 — `{topic: "card-blocked", status:
"in_progress", assigneeId: 3, priority: 1, events: 2}`; `applied: 2`;
warnings `["unknown:starred:seq3", "orphan:seq4"]`.

## Ловушки, которые проверяют случаи

- Дубль по `seq` — молча, без предупреждения (это норма доставки, а
  не аномалия данных).
- Неизвестный тип для существующего обращения не меняет его счётчик.
- `assigned` в статусе `in_progress` — переназначение: оператор
  меняется, статус остаётся.
- Несколько обращений независимы.
- Пустой поток — пустая витрина.
