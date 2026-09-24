# Практика: менеджер graceful shutdown

Каждый сервис «Пульта» при старте открывает ресурсы — пул базы,
подписку на очередь, HTTP-сервер, таймеры — и при `SIGTERM` должен
закрыть их в обратном порядке, не зависнув на одном упрямом ресурсе.
Обычно для этого пишут маленький менеджер: регистрируешь хук на
каждый ресурс, при остановке он выполняет их и отчитывается. Его и
напишем — без настоящих сигналов и без настоящих ресурсов, но с
настоящей логикой.

## Задание

Экспортируй функцию `runShutdown(hooks, timeoutMs)`:

- `hooks` — массив описаний хуков в порядке **регистрации**
  (ресурсы открывались в этом порядке). Каждый хук:

  ```ts
  type Hook = {
    name: string;
    behavior: "ok" | "throw" | "hang";
    durationMs: number; // сколько «занимает» хук по модельным часам
  };
  ```

  - `ok` — хук завершается успешно через `durationMs`;
  - `throw` — хук через `durationMs` бросает `Error(name + " failed")`;
  - `hang` — хук никогда не завершается (`durationMs` игнорируется).

- `timeoutMs` — таймаут **на каждый хук**.

Функция возвращает промис отчёта:

```ts
type Report = {
  order: string[];                          // имена в порядке выполнения
  results: { name: string; status: "ok" | "failed" | "timeout"; elapsedMs: number }[];
  totalMs: number;
};
```

Правила:

- Хуки выполняются **по одному, в обратном порядке регистрации**:
  последний открытый ресурс закрывается первым.
- Хук, который бросил, получает `status: "failed"`; остальные хуки всё
  равно выполняются — одна упавшая очередь не должна оставить открытым
  пул базы.
- Хук, который не завершился за `timeoutMs`, получает
  `status: "timeout"` и `elapsedMs: timeoutMs`; следующий хук
  начинается сразу после таймаута.
- `elapsedMs` — сколько занял хук: `durationMs` для `ok` и `throw`,
  `timeoutMs` для `timeout`. Если `durationMs` больше `timeoutMs`, хук
  тоже считается `timeout`.
- `totalMs` — сумма `elapsedMs` всех хуков.

Время модельное: хук длительностью 5000 мс не должен реально ждать пять
секунд. Реализуй ожидание через `setTimeout` с маленькой задержкой или
без задержки вовсе, а `elapsedMs` вычисляй по правилам выше — движок
проверяет отчёт, а не секундомер. Но структура кода должна быть
настоящей: `Promise.race` между хуком и таймаутом, `try/catch` на хук,
последовательный цикл. Именно это будут смотреть на live-coding.

Заготовка:

```ts
type Hook = { name: string; behavior: "ok" | "throw" | "hang"; durationMs: number };
type Result = { name: string; status: "ok" | "failed" | "timeout"; elapsedMs: number };
type Report = { order: string[]; results: Result[]; totalMs: number };

export async function runShutdown(hooks: Hook[], timeoutMs: number): Promise<Report> {
  // ...
}
```

## Пример

Вход:

```json
[
  { "name": "db-pool",  "behavior": "ok",    "durationMs": 100 },
  { "name": "queue",    "behavior": "hang",  "durationMs": 0 },
  { "name": "http",     "behavior": "throw", "durationMs": 50 }
], 1000
```

Результат:

```json
{
  "order": ["http", "queue", "db-pool"],
  "results": [
    { "name": "http",    "status": "failed",  "elapsedMs": 50 },
    { "name": "queue",   "status": "timeout", "elapsedMs": 1000 },
    { "name": "db-pool", "status": "ok",      "elapsedMs": 100 }
  ],
  "totalMs": 1150
}
```

## Ловушки, которые проверяют случаи

- Хук `hang` не должен подвешивать всю остановку: следующий хук идёт
  после таймаута.
- Порядок — обратный регистрации, даже если хуки падают.
- `durationMs` больше `timeoutMs` — это `timeout`, а не `ok`.
- Пустой список хуков — пустой отчёт с `totalMs: 0`.
