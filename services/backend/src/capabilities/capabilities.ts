// What this engine can do — the single source of truth, in one file.
//
// Why it exists: a course package is data, and whoever writes one (a
// person, or a generator) has to know what the engine will accept. Before
// this, that knowledge was spread across manifest.schema.json, the
// validator, courses/README.md and the route code, and the four could drift
// apart without anything noticing. This module is the authority; the others
// are checked against it:
//
//   - `SANDBOX_TYPES` / `PRACTICE_TYPES` / `ANSWER_FIELD_KINDS` / `CODE_LANGUAGES` are the
//     domain's own unions — courses/types.ts and sandbox/types.ts derive
//     their types from here rather than re-declaring them;
//   - manifest.schema.json's matching `enum`s are checked against these
//     lists by capabilities.test.ts (the schema is a checked-in contract
//     artifact, so it keeps its literal enums rather than being generated —
//     but it may not disagree with this file);
//   - `GET /capabilities` and docs/contracts/capabilities.json are both
//     just this object, serialized.
//
// Project invariant: a practice mechanic or a sandbox type exists only if
// it is registered here. Adding one means an entry in this file plus its
// own module — never a change to plugins/practice/index.ts or to
// sandbox/provisioner.ts, both of which dispatch through a registry keyed
// by these same names.
//
// This file is DATA. It imports the engine's own limit constants so a
// number is never written twice, and nothing else — in particular no route,
// no driver and no strategy, so that everything else may import it.

import { MAX_RESULT_ROWS } from "../plugins/practice/sql/execute.js";
import { MAX_COMPARISON_ROWS, NUMERIC_TOLERANCE } from "../plugins/practice/sql/compare.js";
import { MAX_STATE_ROWS_PER_TABLE } from "../plugins/practice/sql/state.js";
import {
  CODE_MEMORY_MB,
  CODE_TIMEOUT_SECONDS,
  MAX_CODE_CASES,
  MAX_CODE_OUTPUT_CHARS,
  MAX_CODE_VALUE_CHARS,
} from "../plugins/practice/code/limits.js";

/**
 * Version of the course-manifest contract described below.
 *
 * Bumped when a change would make a manifest that is valid today invalid
 * tomorrow (a removed field, a narrowed rule). Purely additive changes — a
 * new practice type, a new optional field — do NOT bump it: a course
 * written against version 1 keeps working, which is the whole promise the
 * number makes.
 */
export const MANIFEST_CONTRACT_VERSION = 1;

// --- The engine's closed vocabularies ------------------------------------
// Declared as const tuples so the union types below are derived from the
// same list the capability documents are built from — one edit, not two.

/** Sandbox kinds a course may declare in `sandboxes[].type`. */
export const SANDBOX_TYPES = ["postgres"] as const;
export type SandboxType = (typeof SANDBOX_TYPES)[number];

/** Practice kinds a course may declare in `practice.type`. */
export const PRACTICE_TYPES = ["sql", "answer", "code"] as const;
export type CoursePracticeType = (typeof PRACTICE_TYPES)[number];

/** Value kinds an `answer` practice field may declare in `fields[].kind`. */
export const ANSWER_FIELD_KINDS = ["number", "text"] as const;
export type AnswerFieldKind = (typeof ANSWER_FIELD_KINDS)[number];

/** Languages a `code` practice may declare in `practice.language`. One
 * runtime (Node) runs both; the list exists so a course names what the
 * learner writes and the editor knows which mode to open. */
export const CODE_LANGUAGES = ["typescript", "javascript"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/**
 * The sandbox role's server-side statement timeout, in seconds.
 *
 * The authoritative setting is `ALTER ROLE trellis_sandbox SET
 * statement_timeout` in docker/postgres/init/02-schemas.sql — it is a
 * property of the database role, not of this process, which is exactly why
 * no code here ever sets it per query. This constant only REPORTS it, and
 * capabilities.test.ts reads that SQL file to make sure the two agree.
 */
export const SANDBOX_STATEMENT_TIMEOUT_SECONDS = 30;

/** Largest `sql` submission the practice endpoint accepts, in characters
 * (plugins/practice/sql/route.ts's body schema). */
export const MAX_PRACTICE_SQL_LENGTH = 50_000;

/** Largest single typed-in answer the `answer` endpoint accepts, in
 * characters (plugins/practice/answer/route.ts's body schema). */
export const MAX_ANSWER_VALUE_LENGTH = 1000;

/** Largest `code` submission the practice endpoint accepts, in characters
 * (plugins/practice/code/route.ts's body schema). */
export const MAX_PRACTICE_CODE_LENGTH = 50_000;

// --- Capability document shapes ------------------------------------------

/** One property a course author may write in the manifest, described for
 * whoever is writing (or generating) that manifest. */
export interface ManifestFieldCapability {
  readonly name: string;
  readonly valueType: "string" | "number" | "boolean" | "object[]" | "any" | "any[]";
  readonly required: boolean;
  readonly summary: string;
  /** The allowed values, when the field is an enum. */
  readonly values?: readonly string[];
  /** What the engine assumes when the field is absent. */
  readonly default?: string | number | boolean;
  /** Properties of each element, for an `object[]` field. */
  readonly fields?: readonly ManifestFieldCapability[];
}

/** One way the engine can decide "зачтено" for a practice assignment. */
export interface GradingMechanicCapability {
  readonly name: string;
  /** The manifest fields that turn this mechanic on. */
  readonly manifestFields: readonly string[];
  readonly summary: string;
  /** What the learner is told when it fails — the contract on how much of
   * the answer a verdict may reveal. */
  readonly feedback: string;
}

export interface SandboxTypeCapability {
  readonly type: SandboxType;
  readonly summary: string;
  /** Whether `sandboxes[].seed` applies, and what it means. */
  readonly seed: string;
  readonly limits: Readonly<Record<string, number>>;
}

export interface PracticeTypeCapability {
  readonly type: CoursePracticeType;
  readonly summary: string;
  /** `true` when the assignment needs a declared sandbox to run in. */
  readonly requiresSandbox: boolean;
  /** Path (relative to a lesson) an attempt is submitted to. The single
   * source for both `endpoint` below and the "you want the other
   * endpoint" refusal in plugins/practice/api.ts. */
  readonly submitPath: string;
  /** Where a learner's attempt is submitted, spelled out. Always derived
   * from `submitPath` — see `submitEndpoint`. */
  readonly endpoint: string;
  /** Every property legal under `practice` for this type. Properties of
   * ANOTHER type are rejected by validation, not ignored. */
  readonly manifestFields: readonly ManifestFieldCapability[];
  /** The grading mechanics available to this type. When several are
   * declared on one assignment, passing requires all of them. */
  readonly mechanics: readonly GradingMechanicCapability[];
  /** How a lesson carrying this kind of assignment becomes completed. */
  readonly completion: string;
}

export interface QuizCapability {
  readonly summary: string;
  readonly manifestFields: readonly ManifestFieldCapability[];
  readonly rules: readonly string[];
}

export interface EngineCapabilities {
  readonly manifestContractVersion: number;
  readonly lesson: {
    readonly summary: string;
    readonly rules: readonly string[];
  };
  readonly quiz: QuizCapability;
  readonly sandboxTypes: readonly SandboxTypeCapability[];
  readonly practiceTypes: readonly PracticeTypeCapability[];
  readonly limits: Readonly<Record<string, number>>;
}

// --- The registry itself -------------------------------------------------

/** Spells out a `submitPath` as the full documented endpoint, so the two
 * can never disagree. */
function submitEndpoint(submitPath: string): string {
  return `POST /courses/{courseId}/lessons/{lessonId}/${submitPath}`;
}

const SQL_PRACTICE: PracticeTypeCapability = {
  type: "sql",
  summary:
    "Задание выполняется в песочнице курса: ученик пишет SQL, движок выполняет его от роли " +
    "песочницы и показывает результат или ошибку Postgres как есть.",
  requiresSandbox: true,
  submitPath: "practice/run",
  endpoint: submitEndpoint("practice/run"),
  manifestFields: [
    {
      name: "type",
      valueType: "string",
      required: false,
      values: [...PRACTICE_TYPES],
      default: "sql",
      summary: 'Тип практики. Отсутствие поля означает "sql" — курсы, написанные до появления других типов, остаются валидными.',
    },
    { name: "prompt", valueType: "string", required: true, summary: "Формулировка задания для ученика." },
    {
      name: "sandbox",
      valueType: "string",
      required: true,
      summary: "id одной из sandboxes[], объявленных этим же курсом.",
    },
    {
      name: "check",
      valueType: "string",
      required: false,
      summary:
        "SQL-запрос по состоянию базы, возвращающий ровно одну строку с одним boolean-столбцом. " +
        "Механика для заданий, которые что-то меняют (INSERT/UPDATE/DELETE).",
    },
    {
      name: "expected",
      valueType: "string",
      required: false,
      summary:
        "Эталонный SQL-запрос: движок выполняет его в read-only транзакции и сравнивает его результат " +
        "с результатом ученика. Механика для SELECT-заданий, не меняющих базу.",
    },
    {
      name: "ordered",
      valueType: "boolean",
      required: false,
      default: false,
      summary:
        "Важен ли порядок строк при сравнении с expected. false — сравниваются мультимножества строк, " +
        "true — последовательности. Допустимо только вместе с expected.",
    },
    {
      name: "solution",
      valueType: "string",
      required: false,
      summary:
        "Эталонное решение задания — тот SQL, которым его решает автор. Движок выполняет его на " +
        "засеянной песочнице, запрос ученика — на такой же, и сравнивает получившиеся СОСТОЯНИЯ базы. " +
        "Строгая механика для заданий, которые меняют данные: ловит и то, о чём задание не спрашивало " +
        "(UPDATE без WHERE). Обязан быть детерминированным: ни now()/random(), ни DEFAULT в seed, " +
        "меняющегося от запуска к запуску.",
    },
  ],
  mechanics: [
    {
      name: "check",
      manifestFields: ["check"],
      summary:
        "После попытки движок выполняет check-запрос от роли песочницы и трактует его единственный " +
        "boolean как «зачтено/не зачтено». Иной формы ответа у check-запроса быть не может — это " +
        "сломанный контент курса, а не неверный ответ ученика.",
      feedback: "Один boolean. Текст запроса и форма его результата клиенту не отдаются.",
    },
    {
      name: "solution",
      manifestFields: ["solution"],
      summary:
        "Сравнение состояния базы после запроса ученика с состоянием после эталонного решения: " +
        "таблица за таблицей, построчно, без учёта физического порядка строк. Сравнивается вся схема " +
        "песочницы целиком, поэтому лишние изменения — тоже расхождение. Сработает, только если каждая " +
        "попытка стартует с эталонного состояния, чем и занят пересев песочницы перед запуском.",
      feedback:
        "Boolean плюс причина в терминах имён таблиц и количеств строк («таблица \"books\": ожидалось " +
        "строк 5, получено 4»). Ни текст решения, ни значения ячеек наружу не уходят.",
    },
    {
      name: "expected",
      manifestFields: ["expected", "ordered"],
      summary:
        "Сравнение результата ученика с результатом эталонного запроса: число столбцов должно совпасть " +
        "(имена столбцов не сравниваются), NULL равен только NULL, числовые столбцы сравниваются с " +
        "абсолютной точностью, остальные — по текстовому представлению Postgres.",
      feedback:
        "Boolean плюс причина в терминах количеств и позиций («ожидалось строк: 19, получено: 22»). " +
        "Ни текст эталона, ни его значения наружу не уходят.",
    },
  ],
  completion:
    "Урок засчитывается, когда пройдены ВСЕ объявленные механики. Если не объявлено ни одной — " +
    "задание закрывается самоотметкой ученика (POST .../complete).",
};

const ANSWER_PRACTICE: PracticeTypeCapability = {
  type: "answer",
  summary:
    "Задание выполняется за пределами платформы (Excel, BI-дашборд, бумага), а ученик вписывает " +
    "полученные значения. Движок не видит процесс и не проверяет его — он сверяет только результат.",
  requiresSandbox: false,
  submitPath: "practice/answer",
  endpoint: submitEndpoint("practice/answer"),
  manifestFields: [
    {
      name: "type",
      valueType: "string",
      required: true,
      values: [...PRACTICE_TYPES],
      summary: 'Должен быть "answer" — для этого типа поле обязательно (умолчание — "sql").',
    },
    { name: "prompt", valueType: "string", required: true, summary: "Формулировка задания для ученика." },
    {
      name: "fields",
      valueType: "object[]",
      required: true,
      summary: "Значения, которые ученик должен сообщить. Минимум одно, id уникальны в пределах задания.",
      fields: [
        {
          name: "id",
          valueType: "string",
          required: true,
          summary: "Стабильный id поля — ключ, под которым клиент отправляет ответ.",
        },
        { name: "label", valueType: "string", required: true, summary: "Подпись поля для ученика." },
        {
          name: "kind",
          valueType: "string",
          required: true,
          values: [...ANSWER_FIELD_KINDS],
          summary: "Тип значения: number (число) или text (строка).",
        },
        {
          name: "expected",
          valueType: "string",
          required: true,
          summary:
            "Верный ответ: число для kind: number, непустая строка для kind: text. Клиенту не отдаётся никогда.",
        },
        {
          name: "tolerance",
          valueType: "number",
          required: false,
          default: 0,
          summary: "Только для kind: number. Абсолютный допуск, >= 0; 0 — точное равенство.",
        },
      ],
    },
  ],
  mechanics: [
    {
      name: "fields",
      manifestFields: ["fields"],
      summary:
        "Сверка введённых значений с fields[].expected. Число читается «как человек его пишет»: запятая " +
        "как десятичный разделитель, пробелы (включая неразрывные) как разделители тысяч; сравнение — с " +
        "точностью до tolerance. Текст сравнивается после trim, без учёта регистра и с нормализацией " +
        "Unicode (NFC). Ничего другого движок не нормализует: синонимы не угадываются.",
      feedback:
        "Один boolean на каждое объявленное поле. Ни эталона, ни допуска, ни того, насколько ответ " +
        "промахнулся, наружу не отдаётся.",
    },
  ],
  completion: "Урок засчитывается, когда верны ВСЕ поля. Повторная отправка разрешена; зачтённый урок не расзачитывается.",
};

const CODE_PRACTICE: PracticeTypeCapability = {
  type: "code",
  summary:
    "Задание выполняется как код: ученик пишет модуль на TypeScript или JavaScript, экспортирующий функцию, " +
    "движок вызывает её в отдельном процессе Node на объявленных входах и сравнивает возвращённые значения " +
    "с эталоном. Вывод в консоль показывается, но не проверяется.",
  requiresSandbox: false,
  submitPath: "practice/code",
  endpoint: submitEndpoint("practice/code"),
  manifestFields: [
    {
      name: "type",
      valueType: "string",
      required: true,
      values: [...PRACTICE_TYPES],
      summary: 'Должен быть "code" — для этого типа поле обязательно (умолчание — "sql").',
    },
    {
      name: "language",
      valueType: "string",
      required: true,
      values: [...CODE_LANGUAGES],
      summary:
        "Язык модуля ученика. Оба исполняются Node: TypeScript — со стиранием типов (только «стираемый» синтаксис: " +
        "без enum, namespace и parameter properties; типы не проверяются, только убираются).",
    },
    { name: "prompt", valueType: "string", required: true, summary: "Формулировка задания для ученика." },
    {
      name: "entry",
      valueType: "string",
      required: true,
      summary:
        "Имя именованного ESM-экспорта, который движок вызывает (`export function sum`). Идентификатор, не `default`.",
    },
    {
      name: "starter",
      valueType: "string",
      required: false,
      summary: "Начальное содержимое редактора — сигнатура с пустым телом. Уходит клиенту как есть.",
    },
    {
      name: "cases",
      valueType: "object[]",
      required: true,
      summary: `Вызовы функции, по которым ставится зачёт. От 1 до ${MAX_CODE_CASES}; проверяются все.`,
      fields: [
        {
          name: "args",
          valueType: "any[]",
          required: true,
          summary: "Аргументы вызова по порядку (любые JSON-значения).",
        },
        {
          name: "expected",
          valueType: "any",
          required: false,
          summary:
            "Ожидаемое возвращаемое значение (любое JSON-значение, null — тоже значение). Если поля нет, эталон " +
            "берётся из solution; без solution поле обязательно. Клиенту не отдаётся никогда.",
        },
      ],
    },
    {
      name: "solution",
      valueType: "string",
      required: false,
      summary:
        "Эталонное решение автора на том же language с тем же entry. Движок вызывает его на тех же args и берёт " +
        "результат как эталон для каждого case без своего expected. Обязано быть детерминированным. Клиенту не " +
        "отдаётся никогда.",
    },
  ],
  mechanics: [
    {
      name: "cases",
      manifestFields: ["cases", "solution"],
      summary:
        "Для каждого case движок вызывает функцию ученика с args, ждёт результат (Promise допустим) и сравнивает " +
        "его с эталоном структурно: порядок ключей объектов не важен, порядок элементов массива важен, числа — " +
        "точно, undefined и null различаются, NaN равен NaN. Исключение или таймаут — case не пройден.",
      feedback:
        "На каждый case: аргументы, СОБСТВЕННЫЙ результат ученика (или его исключение), вывод console и boolean. " +
        "Эталон и текст solution наружу не уходят; причина провала — только «не совпало».",
    },
  ],
  completion:
    "Урок засчитывается, когда пройдены ВСЕ case. Задание без cases невалидно, поэтому самоотметки у этого типа нет.",
};

const POSTGRES_SANDBOX: SandboxTypeCapability = {
  type: "postgres",
  summary:
    "Отдельная схема и отдельная роль в том же экземпляре Postgres. Всё, что исполняется в песочнице — " +
    "seed курса, SQL ученика, check- и expected-запросы — идёт только от роли песочницы, никогда от роли " +
    "приложения. Одновременно живёт песочница ровно одного курса.",
  seed:
    "sandboxes[].seed — список путей к .sql-файлам, выполняются по порядку перед КАЖДОЙ попыткой практики; " +
    "вместе они должны пересоздавать всё нужное курсу с нуля (DDL + данные). Песочница не накапливает " +
    "состояние между попытками и между уроками: задание не может опираться на то, что сделал ученик в " +
    "предыдущем, — и не может быть испорчено этим.",
  limits: {
    statementTimeoutSeconds: SANDBOX_STATEMENT_TIMEOUT_SECONDS,
    maxResultRows: MAX_RESULT_ROWS,
  },
};

/**
 * Everything the engine can do, as one serializable document. Frozen (and
 * only ever built from `as const` data) because it is handed out by `GET
 * /capabilities` and written to docs/contracts/capabilities.json — a caller
 * mutating it would silently change what every later caller is told.
 */
const CAPABILITIES_DOCUMENT: EngineCapabilities = {
  manifestContractVersion: MANIFEST_CONTRACT_VERSION,
  lesson: {
    summary:
      "Урок несёт хотя бы одно из: content (Markdown-файл), quiz, practice — можно любую комбинацию. " +
      "id модулей и уроков стабильны: на них завязан прогресс, и они же попадают в URL API.",
    rules: [
      "id урока уникален по всему курсу, а не только внутри своего модуля.",
      "У урока ровно один способ зачёта: квиз, если он есть; иначе механики практики; иначе самоотметка.",
      "Зачтённый урок никогда не расзачитывается, а повторное прохождение разрешено.",
    ],
  },
  quiz: {
    summary: "Один вопрос с вариантами ответа, ровно один из которых верный.",
    manifestFields: [
      { name: "question", valueType: "string", required: true, summary: "Текст вопроса." },
      {
        name: "options",
        valueType: "object[]",
        required: true,
        summary: "Варианты ответа, минимум два.",
        fields: [
          { name: "id", valueType: "string", required: true, summary: "Стабильный id варианта." },
          { name: "text", valueType: "string", required: true, summary: "Текст варианта." },
          {
            name: "correct",
            valueType: "boolean",
            required: false,
            default: false,
            summary: "Верный ли вариант. Ровно один вариант в квизе должен нести correct: true.",
          },
          {
            name: "explanation",
            valueType: "string",
            required: false,
            summary:
              "Почему вариант неверен — показывается ученику после ответа. Обязателен у каждого " +
              "НЕверного варианта; у верного не нужен.",
          },
        ],
      },
    ],
    rules: [
      "Не более одного квиза на урок — quiz это объект, а не список.",
      "Ровно один вариант с correct: true.",
      "У каждого неверного варианта обязательно explanation.",
      "Ни correct, ни explanation не покидают backend до ответа ученика: клиент получает только id и text.",
      "Верный ответ засчитывает урок; квиз, если он есть, — единственный способ зачёта этого урока.",
    ],
  },
  sandboxTypes: [POSTGRES_SANDBOX],
  practiceTypes: [SQL_PRACTICE, ANSWER_PRACTICE, CODE_PRACTICE],
  limits: {
    /** Строк результата, отдаваемых клиенту (ограничение показа). */
    maxResultRows: MAX_RESULT_ROWS,
    /** Строк на сторону при сравнении с expected (ограничение зачёта). */
    maxComparisonRows: MAX_COMPARISON_ROWS,
    /** Строк в одной таблице при сравнении состояния с solution. */
    maxStateRowsPerTable: MAX_STATE_ROWS_PER_TABLE,
    /** Абсолютная погрешность при сравнении числовых столбцов. */
    numericTolerance: NUMERIC_TOLERANCE,
    /** Таймаут одного запроса в песочнице, секунды. */
    sandboxStatementTimeoutSeconds: SANDBOX_STATEMENT_TIMEOUT_SECONDS,
    /** Максимальная длина SQL-попытки, символов. */
    maxPracticeSqlLength: MAX_PRACTICE_SQL_LENGTH,
    /** Максимальная длина одного введённого ответа, символов. */
    maxAnswerValueLength: MAX_ANSWER_VALUE_LENGTH,
    /** Максимальная длина кода попытки, символов. */
    maxPracticeCodeLength: MAX_PRACTICE_CODE_LENGTH,
    /** Таймаут одного прогона кода (solution или ученика), секунды. */
    codeTimeoutSeconds: CODE_TIMEOUT_SECONDS,
    /** Лимит кучи процесса с кодом, мегабайты. */
    codeMemoryMb: CODE_MEMORY_MB,
    /** Максимум case в одном задании. */
    maxCodeCases: MAX_CODE_CASES,
    /** Символов вывода console на один case. */
    maxCodeOutputChars: MAX_CODE_OUTPUT_CHARS,
    /** Символов в JSON возвращённого значения одного case; больше — ошибка case. */
    maxCodeValueChars: MAX_CODE_VALUE_CHARS,
  },
};

export const CAPABILITIES: EngineCapabilities = Object.freeze(CAPABILITIES_DOCUMENT);

/** The capability document for one practice type, or `undefined` for a
 * type nobody registered. */
export function practiceTypeCapability(type: string): PracticeTypeCapability | undefined {
  return CAPABILITIES.practiceTypes.find((candidate) => candidate.type === type);
}
