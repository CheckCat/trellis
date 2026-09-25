import assert from "node:assert/strict";
import test from "node:test";

import { CAPABILITIES } from "../../capabilities/index.js";
import type { CourseLesson, CoursePractice, CourseQuiz } from "../../courses/types.js";
import { findLesson, gradeMultiQuizAnswer, gradeQuizAnswer, lessonCompletionMode } from "./model.js";
import { courseFixture } from "../test-support.js";

const quiz: CourseQuiz = {
  question: "Which one?",
  multiple: false,
  options: [
    { id: "right", text: "The right one", correct: true },
    { id: "wrong", text: "The wrong one", correct: false, explanation: "Because of a specific mistake." },
  ],
};

const multiQuiz: CourseQuiz = {
  question: "Which ones?",
  multiple: true,
  options: [
    { id: "insert", text: "INSERT", correct: true },
    { id: "update", text: "UPDATE", correct: true },
    { id: "create", text: "CREATE", correct: false, explanation: "That one is DDL." },
  ],
};

void test("lessonCompletionMode: a content-only lesson is completed by hand", () => {
  const lesson: CourseLesson = { id: "l", title: "L", content: "# L" };
  assert.equal(lessonCompletionMode(lesson), "manual");
});

void test("lessonCompletionMode: a lesson with a quiz is completed by the quiz, not by hand", () => {
  const lesson: CourseLesson = { id: "l", title: "L", content: "# L", quiz };
  assert.equal(lessonCompletionMode(lesson), "quiz");
});

void test("lessonCompletionMode: practice WITH a grading mechanic is completed by it, WITHOUT one it is self-marked", () => {
  const checked: CourseLesson = {
    id: "l",
    title: "L",
    practice: { type: "sql", sandbox: "main", prompt: "Do it.", check: "select true" },
  };
  // `expected` is the second mechanic and gates a lesson on its own — a
  // SELECT exercise leaves no state for a `check` to look at.
  const compared: CourseLesson = {
    id: "l",
    title: "L",
    practice: { type: "sql", sandbox: "main", prompt: "Do it.", expected: "select a from t", ordered: false },
  };
  const both: CourseLesson = {
    id: "l",
    title: "L",
    practice: { type: "sql", sandbox: "main", prompt: "Do it.", check: "select true", expected: "select a from t", ordered: true },
  };
  const ungraded: CourseLesson = { id: "l", title: "L", practice: { type: "sql", sandbox: "main", prompt: "Do it." } };
  assert.equal(lessonCompletionMode(checked), "practice");
  assert.equal(lessonCompletionMode(compared), "practice");
  assert.equal(lessonCompletionMode(both), "practice");
  // Project invariant: "задание без механик зачёта — самоотметка".
  assert.equal(lessonCompletionMode(ungraded), "manual");
});

void test("lessonCompletionMode reads the registry, so a NEW practice type is graded without touching it", () => {
  // Drives itself off the capability document instead of naming "sql" and
  // "answer": register a third practice type tomorrow and this test starts
  // covering it the same day. That is the point of the change it guards —
  // `lessonCompletionMode` used to enumerate types and their fields, and an
  // unlisted type silently resolved to `manual`: no credit for solving it,
  // a "mark as done" button for not solving it.
  for (const capability of CAPABILITIES.practiceTypes) {
    for (const mechanic of capability.mechanics) {
      const practice = { type: capability.type, prompt: "Do it." } as Record<string, unknown>;
      // Values are irrelevant — the rule is about a field being WRITTEN.
      // `true` stands in for whatever the field's real type is.
      for (const field of mechanic.manifestFields) {
        practice[field] = true;
      }
      const lesson: CourseLesson = { id: "l", title: "L", practice: practice as unknown as CoursePractice };
      assert.equal(
        lessonCompletionMode(lesson),
        "practice",
        `mechanic "${mechanic.name}" of practice type "${capability.type}" does not gate its lesson`,
      );
    }
  }
});

void test("lessonCompletionMode: a quiz wins over a checked practice on the same lesson (edge case)", () => {
  const lesson: CourseLesson = {
    id: "l",
    title: "L",
    quiz,
    practice: { type: "sql", sandbox: "main", prompt: "Do it.", check: "select true" },
  };
  assert.equal(lessonCompletionMode(lesson), "quiz");
});

void test("gradeQuizAnswer returns the chosen option's verdict and only its own explanation", () => {
  const correct = gradeQuizAnswer(quiz, "right");
  assert.deepEqual(correct, { correct: true, explanation: undefined });

  const incorrect = gradeQuizAnswer(quiz, "wrong");
  assert.deepEqual(incorrect, { correct: false, explanation: "Because of a specific mistake." });

  // The verdict must never carry anything identifying the correct option.
  assert.equal(JSON.stringify(incorrect).includes("right"), false);
});

void test("gradeQuizAnswer returns undefined for an id that is not one of the options (error path)", () => {
  assert.equal(gradeQuizAnswer(quiz, "not-an-option"), undefined);
  assert.equal(gradeQuizAnswer(quiz, ""), undefined);
});

void test("gradeMultiQuizAnswer passes exactly the full correct set", () => {
  const verdict = gradeMultiQuizAnswer(multiQuiz, ["insert", "update"]);
  assert.deepEqual(verdict, {
    correct: true,
    options: [
      { id: "insert", correct: true, explanation: undefined },
      { id: "update", correct: true, explanation: undefined },
    ],
  });
});

void test("gradeMultiQuizAnswer fails a wrong inclusion and reveals only the chosen options", () => {
  const verdict = gradeMultiQuizAnswer(multiQuiz, ["insert", "create"]);
  assert.deepEqual(verdict, {
    correct: false,
    options: [
      { id: "insert", correct: true, explanation: undefined },
      { id: "create", correct: false, explanation: "That one is DDL." },
    ],
  });
  // The verdict must never name an option the learner did not pick.
  assert.equal(JSON.stringify(verdict).includes("update"), false);
});

void test("gradeMultiQuizAnswer fails a correct-but-incomplete set with every chosen option marked correct", () => {
  const verdict = gradeMultiQuizAnswer(multiQuiz, ["insert"]);
  assert.deepEqual(verdict, {
    correct: false,
    options: [{ id: "insert", correct: true, explanation: undefined }],
  });
});

void test("gradeMultiQuizAnswer returns undefined when any id is not one of the options (error path)", () => {
  assert.equal(gradeMultiQuizAnswer(multiQuiz, ["insert", "not-an-option"]), undefined);
  assert.equal(gradeMultiQuizAnswer(multiQuiz, [""]), undefined);
});

void test("findLesson finds a lesson in any module by id, and nothing for an unknown id", () => {
  const course = courseFixture();
  const found = findLesson(course, "b1");
  assert.equal(found?.lesson.id, "b1");
  assert.equal(found?.module.id, "m2");
  assert.equal(findLesson(course, "no-such-lesson"), undefined);
});
