# Практика: проверка доступа оператора к обращению

Реализуем `can()` из прошлого урока — единую точку истины о правах.
Гибрид: роли дают каркас, контекст (отдел, назначенность, состояние
обращения) уточняет. Такое задание на собеседовании любят за то, что
в нём легко забыть одно правило из шести — и случаи это покажут.

## Модель

```ts
type Role = "operator" | "senior" | "supervisor" | "auditor";

type Subject = {
  operatorId: number;
  role: Role;
  departmentId: number;
};

type CaseInfo = {
  id: number;
  departmentId: number;      // отдел, которому принадлежит обращение
  assigneeId: number | null; // назначенный оператор
  status: "open" | "in_progress" | "resolved" | "closed";
};

type Action = "read" | "update" | "reassign" | "close";
```

## Правила (полный список — он и есть спецификация)

1. **auditor** может `read` любое обращение в любом отделе. Никакие
   другие действия ему не доступны — даже в своём отделе.
2. Остальные роли работают **только со своим отделом**: обращение
   чужого отдела — отказ на любое действие.
3. **read** в своём отделе доступен всем ролям (кроме правила 2).
4. **update** (вести обращение): operator — только назначенные на
   себя; senior и supervisor — любые обращения отдела.
5. **reassign** (переназначить): senior и supervisor. Operator — нет,
   даже своё.
6. **close**: supervisor — любое обращение отдела; operator и senior
   — только назначенное на себя.
7. **Закрытое обращение** (`status: "closed"`) нельзя `update`,
   `reassign` и `close` никому — включая supervisor. `read` можно.
8. Правила применяются в порядке: сначала запреты (2, 7), затем
   допуски. Ответ — строка-вердикт.

## Задание

Экспортируй функцию `can(subject, action, caseInfo)`, возвращающую:

- `"allow"` — действие разрешено;
- `"deny:foreign-department"` — правило 2 (не auditor-read);
- `"deny:closed"` — правило 7;
- `"deny:not-assignee"` — операция требует назначенности, а субъект
  не назначен (правила 4 и 6 для operator/senior);
- `"deny:role"` — роль в принципе не допускает действие (reassign у
  operator; любое не-read у auditor).

Приоритет отказов, когда подходит несколько: `foreign-department`,
затем `closed`, затем `role`, затем `not-assignee`.

Заготовка:

```ts
export function can(subject: Subject, action: Action, caseInfo: CaseInfo): string {
  // ...
  return "deny:role";
}
```

## Примеры

- operator(отдел 1) read обращения(отдел 1, чужое) → `allow` (читать
  можно всё своего отдела).
- operator(отдел 1) update обращения(отдел 1, назначено на другого) →
  `deny:not-assignee`.
- auditor(отдел 4) read обращения(отдел 2) → `allow`.
- auditor(отдел 4) close обращения(отдел 4) → `deny:role`.
- supervisor(отдел 2) close закрытого(отдел 2) → `deny:closed`.

## Ловушки, которые проверяют случаи

- Суперроль не обходит инвариант объекта: supervisor и закрытое
  обращение — `deny:closed`.
- auditor и не-read в **своём** отделе — `deny:role`, а не allow.
- Чужой отдел бьёт всё остальное: даже закрытое чужое для
  не-auditor-а — `deny:foreign-department`.
- `assigneeId: null` — не назначено ни на кого: update у operator —
  `deny:not-assignee`.
