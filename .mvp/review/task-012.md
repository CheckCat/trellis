# Review: task 012

## Commits (8f784135283022cccfc9ed2d19b8151bd36fd1e0..HEAD)


## Diffstat (8f784135283022cccfc9ed2d19b8151bd36fd1e0 -> working tree)

 .mvp/ledger.md                                  |   2 +
 services/backend/src/courses/validate.test.ts   | 156 ++++++++++++++++++++++++
 services/backend/src/practice/check.test.ts     |  10 ++
 services/backend/src/progress/reconcile.test.ts |  13 ++
 4 files changed, 181 insertions(+)

## Diff (8f784135283022cccfc9ed2d19b8151bd36fd1e0 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index df8090f..09208a2 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -13,3 +13,5 @@ Task 020: complete (e3617d6cbfa23be8f8a03e809635ca104561db4e)
   concern (task 021): agentType "devops-engineer" did not dispatch — this task ran on general-purpose, WITHOUT the _common.md contract (boundary rules, report format, blocker protocol) that mvp:bootstrap assembled for it. Agents register at session start, so a bootstrap run in this same session yields files that are not dispatchable until the next one. Restart the session and re-run this task if the role's rules mattered.
 Task 021: complete (ef5b165088ce97781679ac01da85f9b2fb44a5c5)
   Ruling (task 021): не переигрываю задачу — изменение сводилось к сужению glob-области гейта и правке комментариев, диффы проверены и закоммичены (ef5b165); контракт _common.md добавил бы форму отчёта, но не изменил бы результат. Цена ошибки: низкая — граница задачи в один скрипт, регресс виден первым же прогоном pretest. Роли зарегистрированы в текущей сессии, дальнейшие задачи диспатчатся штатно.
+  concern (task 011): review split: 2 finding(s) came from a minority of 3 polls — the others approved
+Task 011: complete (8f784135283022cccfc9ed2d19b8151bd36fd1e0)
diff --git a/services/backend/src/courses/validate.test.ts b/services/backend/src/courses/validate.test.ts
index a8b1243..348d89c 100644
--- a/services/backend/src/courses/validate.test.ts
+++ b/services/backend/src/courses/validate.test.ts
@@ -392,3 +392,159 @@ void test("validateManifest rejects a title that is only whitespace (fix round 1
     assert.equal(result.ok, false);
   });
 });
+
+void test("validateManifest rejects a duplicate sandbox id (edge case, task 012)", () => {
+  withPackageDir((dir) => {
+    const yamlText = [
+      "id: fixture-course",
+      "version: 1.0.0",
+      "title: Fixture course",
+      "sandboxes:",
+      "  - id: main",
+      "    type: postgres",
+      "  - id: main",
+      "    type: postgres",
+      "modules:",
+      "  - id: intro",
+      "    title: Intro",
+      "    lessons:",
+      "      - id: only-lesson",
+      "        title: Only lesson",
+      "        quiz:",
+      "          question: Q?",
+      "          options:",
+      "            - id: a",
+      "              text: 'Yes'",
+      "              correct: true",
+      "            - id: b",
+      "              text: 'No'",
+      "              explanation: Nope.",
+      "",
+    ].join("\n");
+    const result = validateManifest(parseYaml(yamlText), dir);
+
+    assert.equal(result.ok, false);
+    if (result.ok) return;
+    assert.ok(result.errors.some((err) => err.path === "sandboxes[1].id" && /duplicate sandbox id/i.test(err.message)));
+  });
+});
+
+void test("validateManifest rejects a duplicate module id (edge case, task 012)", () => {
+  withPackageDir((dir) => {
+    const yamlText = [
+      "id: fixture-course",
+      "version: 1.0.0",
+      "title: Fixture course",
+      "modules:",
+      "  - id: intro",
+      "    title: Intro A",
+      "    lessons:",
+      "      - id: lesson-a",
+      "        title: Lesson A",
+      "        quiz:",
+      "          question: Q?",
+      "          options:",
+      "            - id: a",
+      "              text: 'Yes'",
+      "              correct: true",
+      "            - id: b",
+      "              text: 'No'",
+      "              explanation: Nope.",
+      "  - id: intro",
+      "    title: Intro B",
+      "    lessons:",
+      "      - id: lesson-b",
+      "        title: Lesson B",
+      "        quiz:",
+      "          question: Q?",
+      "          options:",
+      "            - id: a",
+      "              text: 'Yes'",
+      "              correct: true",
+      "            - id: b",
+      "              text: 'No'",
+      "              explanation: Nope.",
+      "",
+    ].join("\n");
+    const result = validateManifest(parseYaml(yamlText), dir);
+
+    assert.equal(result.ok, false);
+    if (result.ok) return;
+    assert.ok(result.errors.some((err) => err.path === "modules[1].id" && /duplicate module id/i.test(err.message)));
+  });
+});
+
+void test("validateManifest rejects a duplicate quiz option id within the same quiz (edge case, task 012)", () => {
+  withPackageDir((dir) => {
+    const yamlText = [
+      "id: fixture-course",
+      "version: 1.0.0",
+      "title: Fixture course",
+      "modules:",
+      "  - id: intro",
+      "    title: Intro",
+      "    lessons:",
+      "      - id: only-lesson",
+      "        title: Only lesson",
+      "        quiz:",
+      "          question: Q?",
+      "          options:",
+      "            - id: a",
+      "              text: 'Yes'",
+      "              correct: true",
+      "            - id: a",
+      "              text: 'No'",
+      "              explanation: Nope.",
+      "",
+    ].join("\n");
+    const result = validateManifest(parseYaml(yamlText), dir);
+
+    assert.equal(result.ok, false);
+    if (result.ok) return;
+    assert.ok(
+      result.errors.some(
+        (err) => err.path === "modules[0].lessons[0].quiz.options[1].id" && /duplicate quiz option id/i.test(err.message),
+      ),
+    );
+  });
+});
+
+void test("validateManifest rejects a content path that escapes the package directory via a symlink (path safety, task 012)", () => {
+  withPackageDir((dir) => {
+    const outsideDir = makeTempDir("trellis-courses-outside-");
+    try {
+      writeFixtureFiles(outsideDir, [{ path: "secret.md", content: "not part of this package" }]);
+      fs.mkdirSync(path.join(dir, "lessons"), { recursive: true });
+      // A symlink whose *target* exists (unlike the plain "../.. " lexical
+      // check above) but resolves, via realpath, outside packageDir — the
+      // one escape resolveSafePath's doc comment says a lexical ".." check
+      // alone cannot catch.
+      fs.symlinkSync(path.join(outsideDir, "secret.md"), path.join(dir, "lessons/escape.md"));
+
+      const yamlText = [
+        "id: fixture-course",
+        "version: 1.0.0",
+        "title: Fixture course",
+        "modules:",
+        "  - id: intro",
+        "    title: Intro",
+        "    lessons:",
+        "      - id: only-lesson",
+        "        title: Only lesson",
+        "        content: lessons/escape.md",
+        "",
+      ].join("\n");
+      const result = validateManifest(parseYaml(yamlText), dir);
+
+      assert.equal(result.ok, false);
+      if (result.ok) return;
+      assert.ok(
+        result.errors.some(
+          (err) => err.path === "modules[0].lessons[0].content" && /outside the package directory/i.test(err.message),
+        ),
+      );
+    } finally {
+      fs.rmSync(outsideDir, { recursive: true, force: true });
+    }
+  });
+});
diff --git a/services/backend/src/practice/check.test.ts b/services/backend/src/practice/check.test.ts
index 75b22f2..87ae48f 100644
--- a/services/backend/src/practice/check.test.ts
+++ b/services/backend/src/practice/check.test.ts
@@ -74,6 +74,16 @@ void test("runPracticeCheck rejects a non-boolean verdict and never echoes the v
   assertViolation(number.error, 'a value of type "number"');
 });
 
+void test("runPracticeCheck describes a timestamp verdict as \"a timestamp\", not typeof's generic \"object\" (edge case, task 012)", async () => {
+  const timestamp = await check(() => resultSet({ columns: ["passed"], rows: [[new Date("2026-01-01T00:00:00.000Z")]] }));
+  assertViolation(timestamp.error, "a timestamp");
+});
+
+void test("runPracticeCheck describes an array-typed verdict as \"an array\", not typeof's generic \"object\" (edge case, task 012)", async () => {
+  const arrayValue = await check(() => resultSet({ columns: ["passed"], rows: [[[1, 2, 3]]] }));
+  assertViolation(arrayValue.error, "an array");
+});
+
 void test("runPracticeCheck rejects a multi-statement check", async () => {
   const multi = await check(() => [checkResult(true), checkResult(true)]);
   assertViolation(multi.error, "is 2 statements");
diff --git a/services/backend/src/progress/reconcile.test.ts b/services/backend/src/progress/reconcile.test.ts
index 8d43663..6d36063 100644
--- a/services/backend/src/progress/reconcile.test.ts
+++ b/services/backend/src/progress/reconcile.test.ts
@@ -225,3 +225,16 @@ void test("reconcile sorts recorded versions by semver precedence, not lexicogra
   ]);
   assert.deepEqual(tree.recordedVersions, ["0.2.0", "0.9.0", "0.10.0"]);
 });
+
+void test("reconcile sorts a pre-release version before its release, and falls back to a string compare between two pre-releases (regression, task 012)", () => {
+  const course = courseFixture(undefined, "2.0.0");
+  const tree = reconcileCourseProgress(course, [
+    // Same major.minor.patch core as each other and as the installed
+    // version — precedence is decided entirely by the pre-release tag,
+    // never reachable through the core-number compare covered above.
+    record(course.id, "a1", { courseVersion: "1.0.0-beta" }),
+    record(course.id, "a2", { courseVersion: "1.0.0-alpha" }),
+    record(course.id, "b1", { courseVersion: "1.0.0" }),
+  ]);
+  assert.deepEqual(tree.recordedVersions, ["1.0.0-alpha", "1.0.0-beta", "1.0.0"]);
+});
```

## Untracked files (new, not yet added)

(none)
