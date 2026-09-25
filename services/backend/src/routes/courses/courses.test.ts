import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { buildServer } from "../../server/index.js";
import { createCourseRegistry } from "../../courses/registry/index.js";
import type { AppPool } from "../../db/pool/index.js";
import {
  makeTempDir,
  validCourseFixtureFiles,
  validManifestYaml,
  writeCoursePackage,
} from "../../courses/test-support.js";

/** Builds a `buildServer({ pool, registry })` app over a temp `coursesDir`
 * with one valid + one broken course package already on disk, and hands it
 * (plus the dir, for adding more packages mid-test) to `run`. Cleans up the
 * temp dir and closes the app afterwards regardless of outcome. */
async function withApp(run: (app: FastifyInstance, coursesDir: string) => Promise<void>): Promise<void> {
  const coursesDir = makeTempDir();
  try {
    writeCoursePackage(coursesDir, "good-course", validManifestYaml("good-course"), validCourseFixtureFiles());
    const brokenYaml = [
      "id: broken-course",
      "version: 1.0.0",
      "title: Broken course",
      "modules:",
      "  - id: intro",
      "    title: Intro",
      "    lessons:",
      "      - id: only-lesson",
      "        title: Only lesson",
      "        practice:",
      "          sandbox: nonexistent",
      "          prompt: Do the thing.",
      "",
    ].join("\n");
    writeCoursePackage(coursesDir, "broken-course", brokenYaml);

    const app = buildServer({ pool: fakePool(), registry: createCourseRegistry(coursesDir), logger: false });
    try {
      await run(app, coursesDir);
    } finally {
      await app.close();
    }
  } finally {
    fs.rmSync(coursesDir, { recursive: true, force: true });
  }
}

// None of the courses routes touch the db pool at all, but buildServer
// always requires one — a fake that throws if anything ever calls it keeps
// that assumption honest instead of silently succeeding against a pool that
// happens to work.
function fakePool(): AppPool {
  const notImplemented = () => {
    throw new Error("courses routes must not touch the db pool");
  };
  return {
    query: notImplemented as unknown as AppPool["query"],
    connect: notImplemented as unknown as AppPool["connect"],
    withTransaction: notImplemented as unknown as AppPool["withTransaction"],
    end: async () => {},
  };
}

void test("GET /courses lists only valid courses, in summary shape (happy path)", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      courses: [
        {
          id: "good-course",
          version: "1.0.0",
          title: "Fixture course",
          description: "A synthetic course used only by backend tests.",
        },
      ],
    });
  });
});

void test("GET /courses/:courseId returns module/lesson structure with hasContent/hasQuiz/hasPractice flags, no answers", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/good-course" });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.id, "good-course");
    assert.deepEqual(body.modules, [
      {
        id: "intro",
        title: "Intro module",
        lessons: [{ id: "first-lesson", title: "First lesson", hasContent: true, hasQuiz: true, hasPractice: true }],
      },
    ]);
  });
});

void test("GET /courses/:courseId/lessons/:lessonId serves quiz.multiple: true for a multi-select quiz", async () => {
  await withApp(async (app, coursesDir) => {
    const multiYaml = validManifestYaml("multi-course").replace(
      '          question: "2 + 2 = ?"\n',
      '          question: "2 + 2 = ?"\n          multiple: true\n',
    );
    writeCoursePackage(coursesDir, "multi-course", multiYaml, validCourseFixtureFiles());
    const rescan = await app.inject({ method: "POST", url: "/courses/rescan" });
    assert.equal(rescan.json().accepted, 2);

    const response = await app.inject({ method: "GET", url: "/courses/multi-course/lessons/first-lesson" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().quiz.multiple, true);
  });
});

void test("GET /courses/:courseId responds 404 with a descriptive body for an unknown course (error path)", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/unknown-course" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "course_not_found");
  });
});

void test("GET /courses/:courseId responds 404 for a rejected (invalid) course id, same as unknown (error path)", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/broken-course" });
    assert.equal(response.statusCode, 404);
  });
});

void test("GET /courses/:courseId/lessons/:lessonId never leaks quiz answers or the practice grading queries", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/good-course/lessons/first-lesson" });
    assert.equal(response.statusCode, 200);
    const bodyText = response.body;
    const body = response.json();

    assert.equal(body.id, "first-lesson");
    assert.equal(body.content, "# First lesson\n\nHello.");
    assert.deepEqual(body.quiz, {
      question: "2 + 2 = ?",
      // `multiple` is not an answer — the client needs it to render radio
      // buttons vs checkboxes; the fixture quiz is single-choice.
      multiple: false,
      options: [
        { id: "a", text: "4" },
        { id: "b", text: "5" },
      ],
    });
    assert.deepEqual(body.practice, { type: "sql", sandbox: "main", prompt: "Do the thing." });

    // Belt and braces on top of the deepEqual shape checks above: the raw
    // response text must not contain the answer-bearing keys at all.
    assert.ok(!bodyText.includes("correct"), "response must not contain a `correct` field");
    assert.ok(!bodyText.includes("explanation"), "response must not contain an `explanation` field");
    assert.ok(!bodyText.includes("check"), "response must not contain the practice `check` query");
    assert.ok(!bodyText.includes("select count"), "response must not contain the check query's SQL");
    // The reference query is the answer to the exercise just as much as
    // the check is — and so is whether its row order matters.
    assert.ok(!bodyText.includes("expected"), "response must not contain the practice `expected` query");
    assert.ok(!bodyText.includes("order by"), "response must not contain the expected query's SQL");
    assert.ok(!bodyText.includes("ordered"), "response must not reveal whether row order is graded");
  });
});

void test("GET /courses/:courseId/lessons/:lessonId responds 404 for an unknown lesson id (error path)", async () => {
  await withApp(async (app) => {
    const response = await app.inject({ method: "GET", url: "/courses/good-course/lessons/unknown-lesson" });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "lesson_not_found");
  });
});

void test("POST /courses/rescan reports accepted/rejected counts and rejection reasons, and picks up new packages (edge case)", async () => {
  await withApp(async (app, coursesDir) => {
    const before = await app.inject({ method: "POST", url: "/courses/rescan" });
    assert.equal(before.statusCode, 200);
    const beforeBody = before.json();
    assert.equal(beforeBody.accepted, 1);
    assert.equal(beforeBody.rejected, 1);
    assert.equal(beforeBody.scanFailed, false);
    assert.equal(beforeBody.scanError, undefined);
    assert.equal(beforeBody.rejectedCourses[0].dir, "broken-course");
    assert.ok(beforeBody.rejectedCourses[0].errors.length > 0);

    // No filesystem watcher — a package added after the app started must
    // stay invisible until the next explicit rescan.
    writeCoursePackage(coursesDir, "late-course", validManifestYaml("late-course"), validCourseFixtureFiles());
    const listBeforeRescan = await app.inject({ method: "GET", url: "/courses" });
    assert.equal(listBeforeRescan.json().courses.length, 1);

    const after = await app.inject({ method: "POST", url: "/courses/rescan" });
    assert.equal(after.json().accepted, 2);

    const listAfterRescan = await app.inject({ method: "GET", url: "/courses" });
    assert.equal(listAfterRescan.json().courses.length, 2);
  });
});

void test(
  "POST /courses/rescan on an unreadable COURSES_DIR reports scanFailed with a reason, distinct from a real success, and GET /courses still shows the previously loaded course (fix round 2)",
  async (t) => {
    const coursesDir = makeTempDir();
    try {
      writeCoursePackage(coursesDir, "good-course", validManifestYaml("good-course"), validCourseFixtureFiles());
      const app = buildServer({ pool: fakePool(), registry: createCourseRegistry(coursesDir), logger: false });
      try {
        const before = await app.inject({ method: "GET", url: "/courses" });
        assert.equal(before.json().courses.length, 1);

        // Same permission-enforcement self-check as
        // courses/registry.test.ts's equivalent unit test — running as root
        // would make chmod 000 a no-op and this test meaningless, so skip
        // rather than false-green.
        fs.chmodSync(coursesDir, 0o000);
        let permissionsAreEnforced = true;
        try {
          fs.readdirSync(coursesDir);
          permissionsAreEnforced = false;
        } catch {
          // expected: EACCES
        }
        if (!permissionsAreEnforced) {
          fs.chmodSync(coursesDir, 0o755);
          t.skip("file permissions are not enforced for this process (likely running as root) — skipping");
          return;
        }

        try {
          // This is the exact scenario the reviewer reproduced: before the
          // fix, this response was `200 {"accepted":1,"rejected":0,
          // "rejectedCourses":[]}` — byte-for-byte identical to a genuine
          // successful no-op rescan, with no way for an HTTP client (or a
          // user clicking "rescan" in a UI) to tell the two apart.
          const rescanResponse = await app.inject({ method: "POST", url: "/courses/rescan" });
          assert.equal(rescanResponse.statusCode, 200);
          const body = rescanResponse.json();

          assert.equal(body.scanFailed, true);
          assert.equal(typeof body.scanError, "string");
          assert.ok(body.scanError.length > 0);
          assert.ok(
            !/EACCES|ENOTDIR|errno|at\s+\S+\s*\(/.test(body.scanError),
            "scanError must read as installer-style prose, not a raw errno/stack trace",
          );
          // Previous state, honestly labeled — not a fresh scan's result.
          assert.equal(body.accepted, 1);
          assert.equal(body.rejected, 0);

          // The actual defect: the previously loaded course must still be
          // visible through the normal read endpoint after a failed rescan.
          const after = await app.inject({ method: "GET", url: "/courses" });
          assert.equal(after.statusCode, 200);
          assert.equal(after.json().courses.length, 1);
          assert.equal(after.json().courses[0].id, "good-course");
        } finally {
          fs.chmodSync(coursesDir, 0o755);
        }
      } finally {
        await app.close();
      }
    } finally {
      fs.rmSync(coursesDir, { recursive: true, force: true });
    }
  },
);
