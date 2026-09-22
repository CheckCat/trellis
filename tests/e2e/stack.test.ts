// Сквозной smoke-тест поднятого стека.
//
// Это единственный тест в репозитории, который работает не с модулем и не с
// `app.inject()`, а с настоящим стеком: docker-compose поднимает postgres,
// backend и frontend, и дальше тест ходит по HTTP ровно туда, куда ходит
// браузер пользователя — в nginx фронтенда, с префиксом /api. Всё, что
// проверяется ниже, проверяется через эту цепочку целиком (nginx → backend →
// postgres → песочница), поэтому падение здесь означает «собранный продукт
// не работает», а не «функция вернула не то».
//
// Почему его нет в `npm test` (и, значит, в .mvp/ci-mirror.sh и CI): он
// собирает и поднимает образы и требует Docker. Запускается отдельно —
// `npm run test:e2e`; типы и линт при этом проверяются на общих основаниях
// (`npm run build` компилирует этот каталог, `npm run lint` его линтит), так
// что тест не гниёт незаметно между запусками.
//
// Тест намеренно написан как ОДИН сценарий с упорядоченными шагами, а не как
// набор независимых тестов: состояние (прогресс, песочница) накапливается в
// одной живой базе, и «отметить урок пройденным» имеет смысл ровно после
// того, как курс провалидирован и виден. Независимость здесь достигалась бы
// только пересозданием стека на каждый шаг — минуты на шаг без единого
// нового утверждения о продукте.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { repoRoot, startStack } from "./helpers/compose.js";

/**
 * Что тест знает о пилотном контент-пакете (courses/pilot-sql, задача 017).
 * Это фикстура теста, а не знание ядра: backend и frontend получают всё это
 * из данных, здесь же оно перечислено потому, что проверить «квиз
 * засчитывается» можно, только зная верный вариант — API его не отдаёт (и
 * не должен). Если пилотный курс меняется, правится этот блок, а не шаги.
 */
const PILOT = {
  courseId: "pilot-sql",
  courseVersion: "1.3.0",
  totalLessons: 9,
  /** Урок без квиза и практики — закрывается только самоотметкой. */
  manualLesson: "what-is-sql",
  quizLesson: "select-basics",
  quizCorrectOption: "select",
  quizWrongOption: "insert",
  /** Практика, проверяемая сравнением результата с эталоном, порядок строк
   * не важен (`expected` + `ordered: false`). */
  comparedPracticeLesson: "practice-instock",
  comparedPracticeSolution: "select title, author from books where in_stock = true",
  /** То же задание без `where` — заведомо неверное решение. */
  comparedPracticeWrongSolution: "select title, author from books",
  /** Практика, где порядок строк — часть ответа (`ordered: true`). */
  orderedPracticeLesson: "practice-by-year",
  orderedPracticeSolution: "select title, published_year from books order by published_year",
  /** То же задание без `order by`: набор строк верный, порядок — нет. */
  orderedPracticeWrongSolution: "select title, published_year from books",
  /** Практика, засчитываемая сравнением состояния базы с состоянием после
   * эталонного решения курса (`solution`). */
  checkedPracticeLesson: "practice-add-book",
  checkedPracticeSolution:
    "insert into books (title, author, published_year, in_stock) " +
    "values ('Мастер и Маргарита', 'Михаил Булгаков', 1967, true)",
  checkedPracticeBookTitle: "Мастер и Маргарита",
  /** Практика без песочницы: ученик вписывает посчитанные значения
   * (`type: answer`). Эталоны — из `sandbox/seed.sql`. */
  answerPracticeLesson: "self-check-books",
  answerPracticeCorrect: {
    "in-stock-count": "3",
    "oldest-title": "евгений онегин",
    // Внутри допуска 0.5 и с запятой как разделителем — обе поблажки
    // движка сразу.
    "average-year": "1854,2",
  },
  answerPracticeWrong: {
    "in-stock-count": "5",
    "oldest-title": "Война и мир",
    "average-year": "1900",
  },
  /** Урок, которого нет в прогрессе к моменту импорта, — им проверяется
   * round-trip: файл экспорта дочитывается обратно и меняет прогресс. */
  importedLesson: "wrap-up",
} as const;

// --- Формы ответов, на которые тест опирается (подмножество JSON Schema
// маршрутов backend'а: только поля, которые действительно проверяются) ----

interface CourseSummary {
  readonly id: string;
  readonly version: string;
  readonly title: string;
}

interface CourseDetail {
  readonly id: string;
  readonly version: string;
  readonly modules: readonly { readonly id: string; readonly lessons: readonly { readonly id: string }[] }[];
}

interface LessonDetail {
  readonly id: string;
  readonly content?: string;
  readonly quiz?: { readonly question: string; readonly options: readonly { readonly id: string }[] };
  readonly practice?: {
    readonly type: "sql" | "answer";
    readonly prompt: string;
    /** Только у `type: sql`. */
    readonly sandbox?: string;
    /** Только у `type: answer` — без эталонов и допусков. */
    readonly fields?: readonly { readonly id: string; readonly label: string; readonly kind: string }[];
  };
}

interface LessonProgress {
  readonly id: string;
  readonly status: "completed" | "not_started";
  readonly completionMode: "manual" | "quiz" | "practice";
}

interface CourseCounters {
  readonly courseId: string;
  readonly courseVersion: string;
  readonly completedLessons: number;
  readonly completed: boolean;
}

interface CourseProgress extends CourseCounters {
  readonly totalLessons: number;
  readonly modules: readonly { readonly lessons: readonly LessonProgress[] }[];
}

interface CompletionResponse {
  readonly lesson: LessonProgress;
  readonly course: CourseCounters;
}

interface QuizAnswerResponse extends CompletionResponse {
  readonly correct: boolean;
  readonly explanation?: string;
}

interface PracticeRunResponse extends CompletionResponse {
  readonly ok: boolean;
  readonly result?: {
    readonly columns: readonly { readonly name: string }[];
    readonly rows: readonly (readonly (string | null)[])[];
  };
  readonly error?: { readonly message: string; readonly code?: string };
  readonly check: { readonly present: boolean; readonly passed?: boolean };
  readonly expected: { readonly present: boolean; readonly passed?: boolean; readonly reason?: string };
  readonly solution: { readonly present: boolean; readonly passed?: boolean; readonly reason?: string };
}

interface PracticeAnswerResponse extends CompletionResponse {
  readonly ok: boolean;
  readonly fields: Readonly<Record<string, { readonly correct: boolean }>>;
}

interface SandboxStatus {
  readonly active: boolean;
  readonly sandboxId?: string;
  readonly seedFiles?: readonly string[];
}

interface ExportedLesson {
  readonly lessonId: string;
  readonly status: "completed";
  readonly completedAt: string;
  readonly courseVersion?: string;
}

interface ProgressExportFile {
  readonly format: string;
  readonly formatVersion: number;
  readonly exportedAt: string;
  readonly courses: readonly {
    readonly courseId: string;
    readonly installedVersion?: string;
    readonly lessons: readonly ExportedLesson[];
  }[];
}

interface ImportResult {
  readonly applied: boolean;
  readonly stale: boolean;
  readonly error?: string;
  readonly summary: {
    readonly courses: number;
    readonly lessons: number;
    readonly created: number;
    readonly earlierCompletions: number;
    readonly unchanged: number;
  };
  readonly coursesNotInstalled: readonly string[];
}

/** Подмножество docs/contracts/capabilities.json, на которое опирается
 * сценарий. Полное равенство с закоммиченным файлом проверяется отдельно —
 * именно поэтому здесь перечислено только то, что тест утверждает сам. */
interface EngineCapabilities {
  readonly manifestContractVersion: number;
  readonly practiceTypes: readonly { readonly type: string }[];
  readonly sandboxTypes: readonly { readonly type: string }[];
}

interface RescanResponse {
  readonly accepted: number;
  readonly rejected: number;
  readonly scanFailed: boolean;
}

// Полчаса потолка: первый прогон собирает оба образа с нуля (npm ci внутри),
// на прогретых слоях сценарий укладывается в пару минут. Потолок нужен,
// чтобы зависший стек не держал прогон вечно.
const SCENARIO_TIMEOUT_MS = 30 * 60 * 1000;

void test("поднятый стек проходит сквозной пользовательский сценарий", { timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const stack = await startStack();
  const api = new ApiClient(stack.apiUrl);
  // Собирается по ходу сценария и сверяется с ответами API: так тест
  // утверждает не «счётчик вырос», а «пройдено ровно это».
  const completed = new Set<string>();

  try {
    await t.test("nginx отдаёт SPA, а /api/health — живую связку с базой", async () => {
      const page = await fetch(stack.appUrl);
      assert.equal(page.status, 200);
      assert.match(page.headers.get("content-type") ?? "", /text\/html/);
      assert.match(await page.text(), /<div id="root">/);

      const health = await api.get<{ status: string; db: string }>("/health");
      assert.equal(health.status, 200);
      assert.deepEqual(health.body, { status: "ok", db: "ok" });
    });

    await t.test("движок отдаёт свой реестр возможностей и он совпадает с закоммиченным контрактом", async () => {
      const capabilities = await api.get<EngineCapabilities>("/capabilities");
      assert.equal(capabilities.status, 200);
      assert.equal(typeof capabilities.body.manifestContractVersion, "number");
      // Ровно то, чем движок умеет пользоваться, — и по этому списку пишутся
      // курсы (в том числе генератором), поэтому он проверяется на живом
      // стеке, а не только юнит-тестом реестра.
      assert.deepEqual(
        capabilities.body.practiceTypes.map((practice) => practice.type).sort(),
        ["answer", "sql"],
      );
      assert.deepEqual(
        capabilities.body.sandboxTypes.map((sandbox) => sandbox.type),
        ["postgres"],
      );

      // Закоммиченный docs/contracts/capabilities.json — тот же документ.
      // Если бы стек отдавал другое, читать файл вместо запуска движка было
      // бы нельзя.
      const committed: unknown = JSON.parse(
        await readFile(join(repoRoot(), "docs/contracts/capabilities.json"), "utf8"),
      );
      assert.deepEqual(capabilities.body as unknown, committed);
    });

    await t.test("контент-пакет из courses/ проходит валидацию и виден в API", async () => {
      const rescan = await api.post<RescanResponse>("/courses/rescan");
      assert.equal(rescan.status, 200);
      assert.equal(rescan.body.scanFailed, false);
      assert.equal(rescan.body.rejected, 0, "ни один пакет в courses/ не должен быть отвергнут валидацией");
      assert.ok(rescan.body.accepted >= 1);

      const list = await api.get<{ courses: readonly CourseSummary[] }>("/courses");
      assert.equal(list.status, 200);
      const course = list.body.courses.find((candidate) => candidate.id === PILOT.courseId);
      assert.ok(course !== undefined, `курс ${PILOT.courseId} не виден в /courses`);
      assert.equal(course.version, PILOT.courseVersion);
      assert.notEqual(course.title, "");

      const detail = await api.get<CourseDetail>(`/courses/${PILOT.courseId}`);
      assert.equal(detail.status, 200);
      const lessonIds = detail.body.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
      assert.equal(lessonIds.length, PILOT.totalLessons);
      assert.ok(lessonIds.includes(PILOT.quizLesson));
    });

    await t.test("урок отдаётся с Markdown-контентом, но без ответов курса", async () => {
      const lesson = await api.get<LessonDetail>(`/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}`);
      assert.equal(lesson.status, 200);
      assert.ok((lesson.body.content ?? "").length > 0, "урок должен нести Markdown-контент");
      assert.ok(lesson.body.quiz !== undefined);
      assert.ok(lesson.body.quiz.options.length > 1);
      // Верный вариант и check-запрос — это ответы к заданиям курса; они
      // не покидают backend ни в каком виде. Проверяется по сырому телу
      // ответа, а не по типам: типы описывают то, что тест ожидает, а
      // утечка была бы как раз полем, которого он не ожидает.
      assert.doesNotMatch(lesson.raw, /"correct"/);
      assert.doesNotMatch(lesson.raw, /"explanation"/);

      const practice = await api.get<LessonDetail>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}`,
      );
      assert.equal(practice.status, 200);
      assert.ok(practice.body.practice !== undefined);
      assert.doesNotMatch(practice.raw, /"check"|"solution"/);
    });

    await t.test("прогресс нового стека пуст", async () => {
      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.status, 200);
      assert.equal(progress.body.totalLessons, PILOT.totalLessons);
      assert.equal(progress.body.completedLessons, 0);
      assert.equal(progress.body.completed, false);
    });

    await t.test("урок отмечается пройденным, а урок с квизом — не отмечается руками", async () => {
      const marked = await api.post<CompletionResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.manualLesson}/complete`,
      );
      assert.equal(marked.status, 200);
      assert.equal(marked.body.lesson.status, "completed");
      assert.equal(marked.body.lesson.completionMode, "manual");
      completed.add(PILOT.manualLesson);
      assert.equal(marked.body.course.completedLessons, completed.size);

      // Ручная отметка урока, который закрывается квизом, — 409: иначе квиз
      // был бы декоративным (инвариант зачёта).
      const refused = await api.post<{ error: string }>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/complete`,
      );
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error, "manual_completion_not_allowed");
    });

    await t.test("квиз: неверный ответ не засчитывает урок, верный — засчитывает", async () => {
      const wrong = await api.post<QuizAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/quiz/answer`,
        { optionId: PILOT.quizWrongOption },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.correct, false);
      assert.equal(wrong.body.lesson.status, "not_started");
      assert.equal(wrong.body.course.completedLessons, completed.size);

      const right = await api.post<QuizAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.quizLesson}/quiz/answer`,
        { optionId: PILOT.quizCorrectOption },
      );
      assert.equal(right.status, 200);
      assert.equal(right.body.correct, true);
      assert.equal(right.body.lesson.status, "completed");
      completed.add(PILOT.quizLesson);
      assert.equal(right.body.course.completedLessons, completed.size);
    });

    await t.test("SQL практики выполняется в песочнице курса", async () => {
      const before = await api.get<SandboxStatus>(`/courses/${PILOT.courseId}/sandbox`);
      assert.equal(before.status, 200);
      assert.equal(before.body.active, false, "песочница поднимается по первому запуску практики, не раньше");

      // Заведомо неверное решение: без `where` вернутся все книги, а не
      // только те, что в наличии.
      const wrong = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: PILOT.comparedPracticeWrongSolution },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.ok, true, `SQL не выполнился: ${wrong.raw}`);
      assert.deepEqual(
        wrong.body.result?.columns.map((column) => column.name),
        ["title", "author"],
      );
      assert.ok((wrong.body.result?.rows.length ?? 0) > 0, "seed курса должен быть применён — строки есть");
      // У этого задания нет check — только сравнение с эталоном.
      assert.deepEqual(wrong.body.check, { present: false });
      assert.equal(wrong.body.expected.present, true);
      assert.equal(wrong.body.expected.passed, false, `неверное решение засчитано: ${wrong.raw}`);
      assert.match(wrong.body.expected.reason ?? "", /ожидалось строк/);
      assert.equal(wrong.body.lesson.status, "not_started");

      const after = await api.get<SandboxStatus>(`/courses/${PILOT.courseId}/sandbox`);
      assert.equal(after.body.active, true);
      assert.deepEqual(after.body.seedFiles, ["sandbox/seed.sql"]);

      // Эталонное решение — засчитывается движком, без самоотметки.
      const solved = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: PILOT.comparedPracticeSolution },
      );
      assert.equal(solved.status, 200);
      assert.deepEqual(solved.body.expected, { present: true, passed: true });
      assert.equal(solved.body.lesson.status, "completed");
      assert.equal(solved.body.lesson.completionMode, "practice");
      completed.add(PILOT.comparedPracticeLesson);
      assert.equal(solved.body.course.completedLessons, completed.size);

      // Ни эталонный запрос, ни признак «порядок важен» наружу не уходят.
      assert.doesNotMatch(solved.raw, /"expectedSql"|in_stock = true/);
    });

    await t.test("ordered: true — тот же набор строк в другом порядке не засчитывается", async () => {
      const unordered = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.orderedPracticeLesson}/practice/run`,
        { sql: PILOT.orderedPracticeWrongSolution },
      );
      assert.equal(unordered.status, 200);
      assert.equal(unordered.body.ok, true, `SQL не выполнился: ${unordered.raw}`);
      // Строки те же и в том же количестве — не сходится именно порядок.
      assert.equal(unordered.body.expected.passed, false, `запрос без ORDER BY засчитан: ${unordered.raw}`);
      assert.match(unordered.body.expected.reason ?? "", /строки различаются/);
      assert.equal(unordered.body.lesson.status, "not_started");

      const ordered = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.orderedPracticeLesson}/practice/run`,
        { sql: PILOT.orderedPracticeSolution },
      );
      assert.equal(ordered.status, 200);
      assert.deepEqual(ordered.body.expected, { present: true, passed: true });
      assert.equal(ordered.body.lesson.status, "completed");
      completed.add(PILOT.orderedPracticeLesson);
      assert.equal(ordered.body.course.completedLessons, completed.size);
    });

    await t.test("ошибка Postgres доходит до клиента как есть, а не как сбой API", async () => {
      const broken = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: "select * from no_such_table_here" },
      );
      assert.equal(broken.status, 200, "ошибка в учебном SQL — это не ошибка HTTP");
      assert.equal(broken.body.ok, false);
      assert.equal(broken.body.error?.code, "42P01");
      assert.ok((broken.body.error?.message ?? "").length > 0);
    });

    await t.test("SQL пользователя исполняется под ролью песочницы — данные ядра ему недоступны", async () => {
      const forbidden = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: "select * from core.lesson_progress" },
      );
      assert.equal(forbidden.status, 200);
      assert.equal(forbidden.body.ok, false, "песочница не должна читать схему ядра");
      // 42501 — insufficient_privilege. Роль песочницы не имеет прав на
      // схему core, где лежит прогресс: ровно то, ради чего заведены две
      // роли.
      assert.equal(forbidden.body.error?.code, "42501", `неожиданная ошибка: ${forbidden.raw}`);
    });

    await t.test("практика с solution засчитывает урок только по совпадению состояния базы", async () => {
      const wrong = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}/practice/run`,
        { sql: "select count(*) from books" },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.ok, true);
      assert.deepEqual(wrong.body.check, { present: false });
      assert.equal(wrong.body.solution.present, true);
      assert.equal(wrong.body.solution.passed, false);
      assert.equal(wrong.body.lesson.status, "not_started");

      // Задание выполнено — и заодно снесено то, о чём оно не просило.
      // Проверка по предикату («книга добавлена?») такое пропускала;
      // сравнение состояния — нет.
      const collateralDamage = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}/practice/run`,
        { sql: `${PILOT.checkedPracticeSolution}; delete from books where id = 2;` },
      );
      assert.equal(collateralDamage.status, 200);
      assert.equal(collateralDamage.body.solution.passed, false, `лишние изменения засчитаны: ${collateralDamage.raw}`);
      assert.match(collateralDamage.body.solution.reason ?? "", /books/);
      assert.equal(collateralDamage.body.lesson.status, "not_started");

      const solved = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.checkedPracticeLesson}/practice/run`,
        { sql: PILOT.checkedPracticeSolution },
      );
      assert.equal(solved.status, 200);
      assert.equal(solved.body.ok, true, `решение не выполнилось: ${solved.raw}`);
      assert.deepEqual(solved.body.solution, { present: true, passed: true });
      assert.equal(solved.body.lesson.status, "completed");
      assert.equal(solved.body.lesson.completionMode, "practice");
      completed.add(PILOT.checkedPracticeLesson);
      assert.equal(solved.body.course.completedLessons, completed.size);
    });

    await t.test("практика без песочницы засчитывается по введённым ответам", async () => {
      // Урок с `type: answer`: песочницы у него нет, отправляется не SQL, а
      // значения, которые ученик получил сам.
      const lesson = await api.get<LessonDetail>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.answerPracticeLesson}`,
      );
      assert.equal(lesson.status, 200);
      assert.equal(lesson.body.practice?.type, "answer");
      assert.equal(lesson.body.practice?.sandbox, undefined, "у задания без песочницы её и не должно быть в ответе");
      assert.deepEqual(
        lesson.body.practice?.fields?.map((practiceField) => practiceField.id),
        ["in-stock-count", "oldest-title", "average-year"],
      );
      // Эталоны — ответы к заданию, наружу они не уходят.
      assert.doesNotMatch(lesson.raw, /"expected"|"tolerance"/);

      const wrong = await api.post<PracticeAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.answerPracticeLesson}/practice/answer`,
        { answers: PILOT.answerPracticeWrong },
      );
      assert.equal(wrong.status, 200);
      assert.equal(wrong.body.ok, false, `неверные ответы засчитаны: ${wrong.raw}`);
      assert.deepEqual(
        Object.fromEntries(Object.entries(wrong.body.fields).map(([id, mark]) => [id, mark.correct])),
        { "in-stock-count": false, "oldest-title": false, "average-year": false },
      );
      assert.equal(wrong.body.lesson.status, "not_started");

      const right = await api.post<PracticeAnswerResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.answerPracticeLesson}/practice/answer`,
        { answers: PILOT.answerPracticeCorrect },
      );
      assert.equal(right.status, 200);
      assert.equal(right.body.ok, true, `верные ответы не засчитаны: ${right.raw}`);
      assert.equal(right.body.lesson.status, "completed");
      assert.equal(right.body.lesson.completionMode, "practice");
      completed.add(PILOT.answerPracticeLesson);
      assert.equal(right.body.course.completedLessons, completed.size);

      // Задание для другого обработчика: SQL-практику сюда не отправить, и
      // наоборот — движок отвечает 409, а не молча грейдит не то.
      const wrongEndpoint = await api.post<{ error: string }>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.answerPracticeLesson}/practice/run`,
        { sql: "select 1" },
      );
      assert.equal(wrongEndpoint.status, 409);
      assert.equal(wrongEndpoint.body.error, "practice_type_mismatch");
    });

    await t.test("каждая попытка стартует с эталонной базы, прогресс при этом остаётся", async () => {
      // Книга была добавлена предыдущим тестом и урок за неё зачтён. Для
      // СЛЕДУЮЩЕГО запуска её в базе нет: песочница пересевается перед
      // каждой попыткой, поэтому задание не может ни опереться на то, что
      // сделал ученик раньше, ни быть испорченным этим.
      const run = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: `select count(*) as n from books where title = '${PILOT.checkedPracticeBookTitle}'` },
      );
      assert.equal(run.body.ok, true);
      assert.deepEqual(run.body.result?.rows, [["0"]], "песочница должна быть как после seed");

      // И «испортить» её напоказ тоже нельзя: следующий запуск снова
      // видит seed.
      const destructive = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: "delete from books; select count(*) as n from books" },
      );
      assert.equal(destructive.body.ok, true, destructive.raw);
      const afterDestructive = await api.post<PracticeRunResponse>(
        `/courses/${PILOT.courseId}/lessons/${PILOT.comparedPracticeLesson}/practice/run`,
        { sql: "select count(*) as n from books" },
      );
      assert.deepEqual(afterDestructive.body.result?.rows, [["5"]], "удаление не должно пережить попытку");

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size, "пересев песочницы не трогает прогресс");
    });

    await t.test("экспорт даёт версионированный файл с зачётами и версиями курсов", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      assert.equal(exported.status, 200);
      assert.equal(exported.body.format, "trellis.progress");
      assert.equal(exported.body.formatVersion, 1);
      assert.ok(!Number.isNaN(Date.parse(exported.body.exportedAt)), "метка времени должна быть разбираемой датой");

      const course = exported.body.courses.find((candidate) => candidate.courseId === PILOT.courseId);
      assert.ok(course !== undefined);
      assert.equal(course.installedVersion, PILOT.courseVersion);
      assert.deepEqual(
        course.lessons.map((lesson) => lesson.lessonId).sort(),
        [...completed].sort(),
        "в файле — ровно пройденные уроки",
      );
    });

    await t.test("импорт того же файла ничего не меняет", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      const imported = await api.post<ImportResult>("/progress/import", exported.body);
      assert.equal(imported.status, 200);
      assert.equal(imported.body.applied, true);
      assert.equal(imported.body.stale, false);
      assert.deepEqual(imported.body.summary, {
        // Ровно то, что лежит в файле: курсы с прогрессом и их уроки.
        courses: exported.body.courses.length,
        lessons: completed.size,
        created: 0,
        earlierCompletions: 0,
        unchanged: completed.size,
      });
      assert.deepEqual(imported.body.coursesNotInstalled, []);

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size);
    });

    await t.test("более старый файл сначала предупреждает, а после подтверждения применяется", async () => {
      const exported = await api.get<ProgressExportFile>("/progress/export");
      const dayEarlier = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      // Файл «со второго компьютера»: старше местного прогресса и несёт один
      // зачёт, которого здесь нет.
      const olderFile: ProgressExportFile = {
        ...exported.body,
        exportedAt: dayEarlier,
        courses: exported.body.courses.map((course) =>
          course.courseId === PILOT.courseId
            ? {
                ...course,
                lessons: [
                  ...course.lessons,
                  {
                    lessonId: PILOT.importedLesson,
                    status: "completed",
                    completedAt: dayEarlier,
                    courseVersion: PILOT.courseVersion,
                  },
                ],
              }
            : course,
        ),
      };

      const warned = await api.post<ImportResult>("/progress/import", olderFile);
      assert.equal(warned.status, 409);
      assert.equal(warned.body.error, "import_older_than_local");
      assert.equal(warned.body.applied, false);
      assert.equal(warned.body.stale, true);
      assert.equal(warned.body.summary.created, 1, "предупреждение показывает, что файл добавил бы");

      const unchangedProgress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(unchangedProgress.body.completedLessons, completed.size, "до подтверждения не пишется ничего");

      const confirmed = await api.post<ImportResult>("/progress/import?confirm=true", olderFile);
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.applied, true);
      assert.equal(confirmed.body.summary.created, 1);
      completed.add(PILOT.importedLesson);

      const progress = await api.get<CourseProgress>(`/courses/${PILOT.courseId}/progress`);
      assert.equal(progress.body.completedLessons, completed.size);
      const restored = progress.body.modules
        .flatMap((module) => module.lessons)
        .find((lesson) => lesson.id === PILOT.importedLesson);
      assert.equal(restored?.status, "completed", "урок из файла виден в дереве курса как пройденный");
    });
  } catch (error) {
    // Падение сквозного теста почти всегда объясняется логами сервисов, а
    // не стеком вызовов в тесте: стек к моменту чтения отчёта уже погашен.
    process.stderr.write(`--- логи стека ---\n${await stack.logs()}\n`);
    throw error;
  } finally {
    await stack.stop();
  }
});

interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
  /** Сырое тело — для утверждений о том, чего в ответе быть НЕ должно. */
  readonly raw: string;
}

/** Минимальный HTTP-клиент поверх fetch: тест ходит в стек ровно так же,
 * как фронтенд, — через nginx и префикс /api. */
class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async get<T>(path: string): Promise<ApiResponse<T>> {
    return await this.send<T>(path, { method: "GET" });
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return await this.send<T>(path, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  }

  private async send<T>(path: string, init: RequestInit): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const raw = await response.text();
    let body: T;
    try {
      body = JSON.parse(raw) as T;
    } catch {
      throw new Error(`${init.method} ${path} вернул не JSON (${response.status}): ${raw.slice(0, 500)}`);
    }
    return { status: response.status, body, raw };
  }
}
