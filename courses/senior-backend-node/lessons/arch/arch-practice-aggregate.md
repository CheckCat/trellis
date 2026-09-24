# Практика: агрегат «Обращение» с инвариантами

Реализуем корень агрегата из прошлого урока: команды меняют
состояние только через методы, инварианты не обходятся, каждое
изменение записывает событие. Это формат live-coding «смоделируйте
сущность с правилами» — и проверка, что инкапсуляция для тебя не
слово.

## Правила домена (спецификация)

Состояния обращения: `open → in_progress → resolved → closed`, плюс
переназначение и эскалация. Команды:

- `create` — создаёт обращение в `open`, без назначенного.
- `assign(operatorId)` — назначить. Разрешено в `open` и
  `in_progress` (переназначение); назначение в `open` переводит в
  `in_progress`. Запрещено в `resolved` и `closed`.
- `escalate` — поднять приоритет на 1 (максимум 3, выше — ошибка
  `priority_max`). Разрешено в любом статусе, кроме `closed`.
- `resolve(resolution)` — перевести в `resolved`. Только из
  `in_progress`; требует непустую резолюцию (`resolution_required`);
  обращение должно быть назначено (`not_assigned`).
- `close` — перевести в `closed`. Только из `resolved`.
- Любая команда к закрытому обращению — ошибка `already_closed`
  (кроме повторного `close` — он тоже `already_closed`).
- Недопустимый переход — ошибка `invalid_transition`.

Порядок проверок в команде: сначала `already_closed`, затем
специфичные проверки команды в порядке из описания выше.

События записываются при каждом успешном изменении: `created`,
`assigned`, `escalated`, `resolved`, `closed`.

## Задание

Экспортируй функцию `runCase(commands)` — она создаёт агрегат и
применяет команды по очереди. Ошибка команды **не** меняет состояние
и **не** прерывает обработку остальных.

```ts
type Command =
  | { cmd: "create" }
  | { cmd: "assign"; operatorId: number }
  | { cmd: "escalate" }
  | { cmd: "resolve"; resolution: string }
  | { cmd: "close" };

type Result = {
  state: {
    status: string;
    assigneeId: number | null;
    priority: number;
    resolution: string | null;
  };
  events: string[];  // "created", "assigned:5", "escalated:2", "resolved", "closed"
  errors: string[];  // "<cmd>:<code>" в порядке возникновения
};

export function runCase(commands: Command[]): Result;
```

Первый элемент всегда `create` (движок это гарантирует); `priority`
начинается с 1. Формат событий: `assigned:<operatorId>`,
`escalated:<новый приоритет>`, остальные — без параметров.

## Пример

```json
[
  { "cmd": "create" },
  { "cmd": "resolve", "resolution": "починили" },
  { "cmd": "assign", "operatorId": 3 },
  { "cmd": "resolve", "resolution": "починили" },
  { "cmd": "close" }
]
```

Результат: state `{status: "closed", assigneeId: 3, priority: 1,
resolution: "починили"}`, events `["created", "assigned:3",
"resolved", "closed"]`, errors `["resolve:invalid_transition"]` —
первая резолюция не прошла: из `open` резолвить нельзя.

## Ловушки, которые проверяют случаи

- `assign` в `open` переводит в `in_progress`; повторный `assign` в
  `in_progress` — переназначение без смены статуса.
- `resolve` с пустой (или пробельной) резолюцией — ошибка, состояние
  нетронуто.
- Эскалация выше 3 — ошибка `escalate:priority_max`, приоритет не
  меняется.
- После `close` любая команда, включая второй `close`, —
  `<cmd>:already_closed`.
- `close` из `in_progress` (минуя resolved) — `invalid_transition`.
