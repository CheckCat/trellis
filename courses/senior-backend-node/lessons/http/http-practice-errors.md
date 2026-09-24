# Практика: маппинг доменных ошибок в HTTP-ответ

Единая точка, где доменные ошибки становятся HTTP-ответами, — та самая
вещь, которую ты делал в BFF и которую регулярно просят набросать на
собеседовании: «покажите, как у вас устроена обработка ошибок».
Главное свойство этой точки — она **не доверяет** ошибке: всё
неизвестное превращается в анонимный ответ без утечки внутренностей.

## Задание

Экспортируй функцию `toHttpError(err, correlationId)`:

```ts
type DomainError = {
  kind?: string;
  message?: string;
  details?: { field: string; issue: string }[];
};

type HttpError = {
  status: number;
  body: {
    code: string;
    message: string;
    correlationId: string;
    details?: { field: string; issue: string }[];
  };
};

export function toHttpError(err: DomainError, correlationId: string): HttpError {
  // ...
}
```

Правила маппинга:

| `err.kind` | статус | `code` | `message` |
|---|---|---|---|
| `"not-found"` | 404 | `not_found` | `err.message` |
| `"conflict"` | 409 | `conflict` | `err.message` |
| `"validation"` | 422 | `validation_failed` | всегда `"Запрос не прошёл валидацию"` |
| `"unauthenticated"` | 401 | `unauthenticated` | всегда `"Требуется вход"` |
| `"forbidden"` | 403 | `forbidden` | всегда `"Недостаточно прав"` |
| `"upstream-unavailable"` | 503 | `upstream_unavailable` | всегда `"Сервис временно недоступен"` |
| всё остальное (включая отсутствующий kind) | 500 | `internal` | всегда `"Внутренняя ошибка"` |

Дополнительно:

- `correlationId` кладётся в тело всегда.
- `details` включаются в тело **только** для `validation` и только
  если они есть у ошибки. Для остальных видов `details` не включаются,
  даже если пришли.
- Для 500, 503, 401, 403 и 422 собственный `message` ошибки наружу не
  попадает никогда — в нём могут быть внутренности (тексты драйвера
  базы, адреса сервисов). Для `not-found` и `conflict` `message`
  доменный и написан для людей — он проходит; если его нет, подставь
  `"Не найдено"` и `"Конфликт"` соответственно.
- Поле `details` без значения должно **отсутствовать** в объекте, а не
  лежать как `undefined` (сериализация в JSON различает это — проверь
  через `"details" in body`).

## Пример

```js
toHttpError(
  { kind: "boom", message: "connect ECONNREFUSED 10.0.3.17:5432" },
  "req-1"
)
```

→ `{ status: 500, body: { code: "internal", message: "Внутренняя
ошибка", correlationId: "req-1" } }` — адрес базы наружу не ушёл.

## Ловушки, которые проверяют случаи

- Неизвестная ошибка с чувствительным message — message не
  просачивается.
- `validation` без details — тела без ключа `details`.
- `conflict` с details — details отброшены.
- `not-found` без message — подставлен запасной текст.
