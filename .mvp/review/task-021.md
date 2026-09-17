# Review: task 021

## Commits (e3617d6cbfa23be8f8a03e809635ca104561db4e..HEAD)


## Diffstat (e3617d6cbfa23be8f8a03e809635ca104561db4e -> working tree)

 .mvp/ledger.md                 |  2 ++
 .mvp/plan.json                 | 16 ++++++++++++++++
 scripts/check-text-sources.mjs | 38 +++++++++++++++++++++++++-------------
 3 files changed, 43 insertions(+), 13 deletions(-)

## Diff (e3617d6cbfa23be8f8a03e809635ca104561db4e -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index cb3e68c..2afaa1e 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -8,3 +8,5 @@ Task 008: complete (843d7efabf61b7892b2178297f4700a5f4341250)
 Task 009: complete (ee9fefddd0f3d5deac0e86d56cf5cf68ce11b402)
   concern (task 010): `bash .mvp/ci-mirror.sh` → 0 трижды подряд (209 тестов, 0 fail, 0 skipped). Concerns: 1. Байт 0x00, из-за которого отменили первый прогон, пришёл НЕ из 010, а из коммита `711625f` (задача 007) — лежал в HEAD и в 008/009. Удалён здесь. Он же остался в `.mvp/review/task-007.md` (вне границы). Воспроизводится записью `} ${` внутри template literal инструментом — так писать нельзя; см. раздел «Инцидент с байтом 0x00» в отчёте. 2. Реализация восстановлена из `stash@{0}` («park task-010») — она не был
 Task 010: complete (b8ed32f068bf522a35f2186e468bb3c0d8fc23cf)
+  concern (task 020): - Gate wired via root `pretest` npm script (new `scripts/check-text-sources.mjs`), firing identically in `.mvp/ci-mirror.sh` and `.github/workflows/ci.yml` without editing either — both already run the byte-identical `npm run test --if-present`. - Scoped `.mvp/` out of the scan: two pre-existing review reports legitimately quote a NUL byte from reviewed source; rewriting historical review records was out of scope/inappropriate. Full rationale in `.mvp/reports/task-020.md`. - `bash .mvp/ci-mirror`
+Task 020: complete (e3617d6cbfa23be8f8a03e809635ca104561db4e)
diff --git a/.mvp/plan.json b/.mvp/plan.json
index 68a93eb..2e37fab 100644
--- a/.mvp/plan.json
+++ b/.mvp/plan.json
@@ -418,6 +418,22 @@
       "id": "020",
       "epoch": 1,
       "actual_tokens": 88965
+    },
+    {
+      "title": "Сузить область гейта не-текстовых байт: исключить из сканирования .mvp/ (сгенерированный аудит-след пайплайна — ревью-пакеты законно цитируют произвольные байты и делают гейт самовоспроизводяще красным), оставив под проверкой весь исходный код проекта; привести комментарии скрипта в соответствие с фактической областью.",
+      "level": 1,
+      "service": "root",
+      "service_path": ".",
+      "role": "devops-engineer",
+      "files": [
+        "scripts/check-text-sources.mjs"
+      ],
+      "depends_on": [],
+      "estimate_tokens": 6000,
+      "status": "pending",
+      "complexity_class": "boilerplate",
+      "id": "021",
+      "epoch": 1
     }
   ]
 }
diff --git a/scripts/check-text-sources.mjs b/scripts/check-text-sources.mjs
index c438a51..0a5392b 100644
--- a/scripts/check-text-sources.mjs
+++ b/scripts/check-text-sources.mjs
@@ -1,8 +1,10 @@
 #!/usr/bin/env node
-// Gate: no git-tracked file may contain a NUL byte (0x00) — the standard
-// signal that a file is binary or was corrupted/mis-encoded (e.g. saved as
-// UTF-16, or truncated) when every tracked path in this repo is expected to
-// be plain text.
+// Gate: no git-tracked source file may contain a NUL byte (0x00) — the
+// standard signal that a file is binary or was corrupted/mis-encoded (e.g.
+// saved as UTF-16, or truncated) when every tracked source path in this
+// repo is expected to be plain text. Scope is every tracked path EXCEPT
+// `.mvp/` (the pipeline's generated audit trail — see the comment on
+// `listTrackedFiles` below for why).
 //
 // Wired in as npm's "pretest" lifecycle hook (see package.json) rather than
 // referenced from .mvp/ci-mirror.sh or .github/workflows/ci.yml directly:
@@ -17,20 +19,30 @@
 import { execFileSync } from 'node:child_process';
 import { readFileSync } from 'node:fs';
 
-// The brief for this gate is unqualified: "ни один отслеживаемый исходник"
-// — not a single tracked file, no directory carve-out. So every path from
-// `git ls-files` is in scope, .mvp/ (the pipeline's own audit trail)
-// included. Prose that needs to talk about a NUL byte quotes it via escape
-// notation (`\x00`, the same convention already used elsewhere in .mvp/ for
-// this exact byte) rather than embedding the raw control byte — the same
-// way a raw byte would need representing in any other tracked text file.
+// The gate covers every tracked source file in the project — but not
+// `.mvp/`. That directory is the pipeline's own generated audit trail:
+// review packages inside it legitimately quote arbitrary bytes (including
+// raw NUL) verbatim as evidence of what a gate rejected, which made this
+// same check self-reproducingly red the moment a review package cited a
+// NUL byte it was reporting on, rather than one it was introducing as a
+// source-encoding bug. Excluding `.mvp/` keeps the gate meaningful for its
+// actual purpose (catching mis-encoded/binary source) without it tripping
+// over its own audit log. Prose elsewhere in the project that needs to
+// talk about a NUL byte still quotes it via escape notation (`\x00`, the
+// same convention already used in `.mvp/` for this exact byte) rather than
+// embedding the raw control byte — that convention is what keeps `.mvp/`
+// itself readable text, it's just no longer this gate's job to enforce it.
 
 function listTrackedFiles() {
   // `-z` NUL-delimits the listing so paths with spaces/newlines round-trip
   // safely; `git ls-files` already excludes .git/ and anything untracked
-  // (node_modules, build output, .gitignore'd files).
+  // (node_modules, build output, .gitignore'd files). `.mvp/` is excluded
+  // here too — see the comment above.
   const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
-  return raw.split('\0').filter((path) => path.length > 0);
+  return raw
+    .split('\0')
+    .filter((path) => path.length > 0)
+    .filter((path) => path !== '.mvp' && !path.startsWith('.mvp/'));
 }
 
 function findNulPosition(buffer) {
```

## Untracked files (new, not yet added)

(none)
