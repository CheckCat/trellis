# Review: task 015

## Commits (31e2e2876d579e40265a4417e62170f356968294..HEAD)


## Diffstat (31e2e2876d579e40265a4417e62170f356968294 -> working tree)

 .mvp/ledger.md                                     |   2 +
 package-lock.json                                  | 226 ++++++++++++++++++++-
 services/frontend/package.json                     |   2 +
 services/frontend/src/api/client.ts                |  19 ++
 services/frontend/src/api/types.ts                 |  89 ++++++++
 .../src/features/lesson/LessonView.test.tsx        |  21 ++
 .../frontend/src/features/lesson/LessonView.tsx    |   7 +
 services/frontend/src/index.css                    | 117 +++++++++++
 services/frontend/vite.config.ts                   |   3 +
 9 files changed, 485 insertions(+), 1 deletion(-)

## Diff (31e2e2876d579e40265a4417e62170f356968294 -> working tree, tracked files, staged + unstaged)

```diff
diff --git a/.mvp/ledger.md b/.mvp/ledger.md
index d64b24f..b716261 100644
--- a/.mvp/ledger.md
+++ b/.mvp/ledger.md
@@ -19,3 +19,5 @@ Task 011: complete (8f784135283022cccfc9ed2d19b8151bd36fd1e0)
 Task 012: complete (0f47e8d6574564e44f4f977b8da54d863cc2e94c)
   concern (task 013): review split: 1 finding(s) came from a minority of 3 polls — the others approved
 Task 013: complete (9f395227edf81aa302c254d4dc072eee257e8065)
+  concern (task 014): review split: 2 finding(s) came from a minority of 3 polls — the others approved
+Task 014: complete (31e2e2876d579e40265a4417e62170f356968294)
diff --git a/package-lock.json b/package-lock.json
index afb2014..d1aad30 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -82,7 +82,6 @@
       "version": "7.29.7",
       "resolved": "https://registry.npmjs.org/@babel/runtime/-/runtime-7.29.7.tgz",
       "integrity": "sha512-Nq8OhGWiZIZGV6hLHoyAKLLcJihP/xFeBMGJoUrxTX2psI8dCifzLhZISFb+VWS3wFMRDmCGw5R+dOySCqPLhw==",
-      "dev": true,
       "license": "MIT",
       "engines": {
         "node": ">=6.9.0"
@@ -125,6 +124,113 @@
         "keyv": "^5.6.0"
       }
     },
+    "node_modules/@codemirror/autocomplete": {
+      "version": "6.20.3",
+      "resolved": "https://registry.npmjs.org/@codemirror/autocomplete/-/autocomplete-6.20.3.tgz",
+      "integrity": "sha512-tlosUqb+3BbxCxZdu4tKeRghPFC+QM7q4X5YhKV2eCmPG+1r2F3f4AaSz5sCrFqUtX4Jh20VFTKecl16MgiV9g==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.17.0",
+        "@lezer/common": "^1.0.0"
+      }
+    },
+    "node_modules/@codemirror/commands": {
+      "version": "6.11.1",
+      "resolved": "https://registry.npmjs.org/@codemirror/commands/-/commands-6.11.1.tgz",
+      "integrity": "sha512-O/4hG3SC1YwcmQ0d2UVNDs+AsaNWd1iHVxbTeEBuqH+6bExAiPK3iS/BvpY6rZGURALv4ZD3sIgcCmRvw3ehBg==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/state": "^6.7.0",
+        "@codemirror/view": "^6.27.0",
+        "@lezer/common": "^1.1.0"
+      }
+    },
+    "node_modules/@codemirror/lang-sql": {
+      "version": "6.10.0",
+      "resolved": "https://registry.npmjs.org/@codemirror/lang-sql/-/lang-sql-6.10.0.tgz",
+      "integrity": "sha512-6ayPkEd/yRw0XKBx5uAiToSgGECo/GY2NoJIHXIIQh1EVwLuKoU8BP/qK0qH5NLXAbtJRLuT73hx7P9X34iO4w==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/autocomplete": "^6.0.0",
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/state": "^6.0.0",
+        "@lezer/common": "^1.2.0",
+        "@lezer/highlight": "^1.0.0",
+        "@lezer/lr": "^1.0.0"
+      }
+    },
+    "node_modules/@codemirror/language": {
+      "version": "6.12.4",
+      "resolved": "https://registry.npmjs.org/@codemirror/language/-/language-6.12.4.tgz",
+      "integrity": "sha512-1q4PaT+o6PbgpkJt4Q8Fv5XJxTy4FUZ4MWETtyiDw3J0Pyr9E2vqcKL+k9wcvjNTIsauxvE7OfmWj3FRPHQ76A==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.23.0",
+        "@lezer/common": "^1.5.0",
+        "@lezer/highlight": "^1.0.0",
+        "@lezer/lr": "^1.0.0",
+        "style-mod": "^4.0.0"
+      }
+    },
+    "node_modules/@codemirror/lint": {
+      "version": "6.9.7",
+      "resolved": "https://registry.npmjs.org/@codemirror/lint/-/lint-6.9.7.tgz",
+      "integrity": "sha512-28/+iWLYxKxsvGYhSYL7zaCZqLz5+FFFDq9tVsvGv9kv8RY4fFAchJ5WX9M3YrrRlTIsECjsXPqeNgnSmNP2dg==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.42.0",
+        "crelt": "^1.0.5"
+      }
+    },
+    "node_modules/@codemirror/search": {
+      "version": "6.7.2",
+      "resolved": "https://registry.npmjs.org/@codemirror/search/-/search-6.7.2.tgz",
+      "integrity": "sha512-gUYkYhT2+n/+VGZ+8EzE5WFkYZUZYm1VOKDudIsNqh42uRVQJ0a6Yss9sdKT3MeOYfuL1N6AZA57oza0Oyr0LA==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.37.0",
+        "crelt": "^1.0.5"
+      }
+    },
+    "node_modules/@codemirror/state": {
+      "version": "6.7.5",
+      "resolved": "https://registry.npmjs.org/@codemirror/state/-/state-6.7.5.tgz",
+      "integrity": "sha512-QjLbZmY1Au3JiRrDVYFLRD0BZ3SOKS9pR3yjIkd7u27YY8TFD9/Q9fhPnLV5l1mHFSo3hHU/N31vpwEJOx4owQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@marijn/find-cluster-break": "^1.0.0"
+      }
+    },
+    "node_modules/@codemirror/theme-one-dark": {
+      "version": "6.1.3",
+      "resolved": "https://registry.npmjs.org/@codemirror/theme-one-dark/-/theme-one-dark-6.1.3.tgz",
+      "integrity": "sha512-NzBdIvEJmx6fjeremiGp3t/okrLPYT0d9orIc7AFun8oZcRk58aejkqhv6spnz4MLAevrKNPMQYXEWMg4s+sKA==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.0.0",
+        "@lezer/highlight": "^1.0.0"
+      }
+    },
+    "node_modules/@codemirror/view": {
+      "version": "6.43.12",
+      "resolved": "https://registry.npmjs.org/@codemirror/view/-/view-6.43.12.tgz",
+      "integrity": "sha512-Nv0vxQ19NAqvB/c2pFzjIzFlzzJl7jmdtNkwOwGbn0Ks9mFAzibvumz7cQem5cRsFA2cEw2fg+uHZGbcHupLQQ==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/state": "^6.7.0",
+        "crelt": "^1.0.6",
+        "style-mod": "^4.1.0",
+        "w3c-keyname": "^2.2.4"
+      }
+    },
     "node_modules/@csstools/color-helpers": {
       "version": "6.1.1",
       "resolved": "https://registry.npmjs.org/@csstools/color-helpers/-/color-helpers-6.1.1.tgz",
@@ -678,6 +784,36 @@
       "dev": true,
       "license": "MIT"
     },
+    "node_modules/@lezer/common": {
+      "version": "1.5.2",
+      "resolved": "https://registry.npmjs.org/@lezer/common/-/common-1.5.2.tgz",
+      "integrity": "sha512-sxQE460fPZyU3sdc8lafxiPwJHBzZRy/udNFynGQky1SePYBdhkBl1kOagA9uT3pxR8K09bOrmTUqA9wb/PjSQ==",
+      "license": "MIT"
+    },
+    "node_modules/@lezer/highlight": {
+      "version": "1.2.3",
+      "resolved": "https://registry.npmjs.org/@lezer/highlight/-/highlight-1.2.3.tgz",
+      "integrity": "sha512-qXdH7UqTvGfdVBINrgKhDsVTJTxactNNxLk7+UMwZhU13lMHaOBlJe9Vqp907ya56Y3+ed2tlqzys7jDkTmW0g==",
+      "license": "MIT",
+      "dependencies": {
+        "@lezer/common": "^1.3.0"
+      }
+    },
+    "node_modules/@lezer/lr": {
+      "version": "1.4.10",
+      "resolved": "https://registry.npmjs.org/@lezer/lr/-/lr-1.4.10.tgz",
+      "integrity": "sha512-rnCpTIBafOx4mRp43xOxDJbFipJm/c0cia/V5TiGlhmMa+wsSdoGmUN3w5Bqrks/09Q/D4tNAmWaT8p6NRi77A==",
+      "license": "MIT",
+      "dependencies": {
+        "@lezer/common": "^1.0.0"
+      }
+    },
+    "node_modules/@marijn/find-cluster-break": {
+      "version": "1.0.4",
+      "resolved": "https://registry.npmjs.org/@marijn/find-cluster-break/-/find-cluster-break-1.0.4.tgz",
+      "integrity": "sha512-Wy0V7+SGUjnF9/TkiM1hKVDPj7jKXduPNboMVtHTA8dySMURWqfg/JZ9E2Sq8JgSJmkl7k7Qe9FLeMSrSraWmQ==",
+      "license": "MIT"
+    },
     "node_modules/@oxc-project/types": {
       "version": "0.149.0",
       "resolved": "https://registry.npmjs.org/@oxc-project/types/-/types-0.149.0.tgz",
@@ -1501,6 +1637,59 @@
         "url": "https://opencollective.com/typescript-eslint"
       }
     },
+    "node_modules/@uiw/codemirror-extensions-basic-setup": {
+      "version": "4.25.11",
+      "resolved": "https://registry.npmjs.org/@uiw/codemirror-extensions-basic-setup/-/codemirror-extensions-basic-setup-4.25.11.tgz",
+      "integrity": "sha512-otyFa+n9IOYtEjaKOxPedHkj15fTPUF21wdR9pv0GpZPfuGl27cvmcv6+tognbRu9VvEcsHKE+ESoszeo3KfTw==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/autocomplete": "^6.0.0",
+        "@codemirror/commands": "^6.0.0",
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/lint": "^6.0.0",
+        "@codemirror/search": "^6.0.0",
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.0.0"
+      },
+      "funding": {
+        "url": "https://jaywcjlove.github.io/#/sponsor"
+      },
+      "peerDependencies": {
+        "@codemirror/autocomplete": ">=6.0.0",
+        "@codemirror/commands": ">=6.0.0",
+        "@codemirror/language": ">=6.0.0",
+        "@codemirror/lint": ">=6.0.0",
+        "@codemirror/search": ">=6.0.0",
+        "@codemirror/state": ">=6.0.0",
+        "@codemirror/view": ">=6.0.0"
+      }
+    },
+    "node_modules/@uiw/react-codemirror": {
+      "version": "4.25.11",
+      "resolved": "https://registry.npmjs.org/@uiw/react-codemirror/-/react-codemirror-4.25.11.tgz",
+      "integrity": "sha512-DYVFAKLX+F/4JS9N/7xexh+TICrlncwkX9HKKInrP1bwO0tSfc3k0GB6oawTYhelVKh20cX3TuRx+NJSkVXuMw==",
+      "license": "MIT",
+      "dependencies": {
+        "@babel/runtime": "^7.18.6",
+        "@codemirror/commands": "^6.1.0",
+        "@codemirror/state": "^6.1.1",
+        "@codemirror/theme-one-dark": "^6.0.0",
+        "@uiw/codemirror-extensions-basic-setup": "4.25.11",
+        "codemirror": "^6.0.0"
+      },
+      "funding": {
+        "url": "https://jaywcjlove.github.io/#/sponsor"
+      },
+      "peerDependencies": {
+        "@babel/runtime": ">=7.11.0",
+        "@codemirror/state": ">=6.0.0",
+        "@codemirror/theme-one-dark": ">=6.0.0",
+        "@codemirror/view": ">=6.0.0",
+        "codemirror": ">=6.0.0",
+        "react": ">=17.0.0",
+        "react-dom": ">=17.0.0"
+      }
+    },
     "node_modules/@ungap/structured-clone": {
       "version": "1.4.0",
       "resolved": "https://registry.npmjs.org/@ungap/structured-clone/-/structured-clone-1.4.0.tgz",
@@ -1868,6 +2057,21 @@
         "url": "https://github.com/sponsors/wooorm"
       }
     },
+    "node_modules/codemirror": {
+      "version": "6.0.2",
+      "resolved": "https://registry.npmjs.org/codemirror/-/codemirror-6.0.2.tgz",
+      "integrity": "sha512-VhydHotNW5w1UGK0Qj96BwSk/Zqbp9WbnyK2W/eVMv4QyF41INRGpjUhFJY7/uDNuudSc33a/PKr4iDqRduvHw==",
+      "license": "MIT",
+      "dependencies": {
+        "@codemirror/autocomplete": "^6.0.0",
+        "@codemirror/commands": "^6.0.0",
+        "@codemirror/language": "^6.0.0",
+        "@codemirror/lint": "^6.0.0",
+        "@codemirror/search": "^6.0.0",
+        "@codemirror/state": "^6.0.0",
+        "@codemirror/view": "^6.0.0"
+      }
+    },
     "node_modules/comma-separated-tokens": {
       "version": "2.0.3",
       "resolved": "https://registry.npmjs.org/comma-separated-tokens/-/comma-separated-tokens-2.0.3.tgz",
@@ -1897,6 +2101,12 @@
       "integrity": "sha512-UaXxwISYJPTr9hwQxMFYZ7kNhSXboMXP+Z3TRX6f1/NyaGPfuNUZOWP1pUEb75B2HjfklIYLVRfWiFZJyC6Npg==",
       "license": "MIT"
     },
+    "node_modules/crelt": {
+      "version": "1.0.7",
+      "resolved": "https://registry.npmjs.org/crelt/-/crelt-1.0.7.tgz",
+      "integrity": "sha512-aK6BbWfhf4U/wCcLHKPJl/xa6VkVstRaPywWtMKGwuOLc/wZTyQYuoxgvZnNsBvv7Kg3YTBQYYBCggcviQczuA==",
+      "license": "MIT"
+    },
     "node_modules/cross-spawn": {
       "version": "7.0.6",
       "resolved": "https://registry.npmjs.org/cross-spawn/-/cross-spawn-7.0.6.tgz",
@@ -4661,6 +4871,12 @@
         "url": "https://github.com/sponsors/wooorm"
       }
     },
+    "node_modules/style-mod": {
+      "version": "4.1.3",
+      "resolved": "https://registry.npmjs.org/style-mod/-/style-mod-4.1.3.tgz",
+      "integrity": "sha512-i/n8VsZydrugj3Iuzll8+x/00GH2vnYsk1eomD8QiRrSAeW6ItbCQDtfXCeJHd0iwiNagqjQkvpvREEPtW3IoQ==",
+      "license": "MIT"
+    },
     "node_modules/style-to-js": {
       "version": "1.1.21",
       "resolved": "https://registry.npmjs.org/style-to-js/-/style-to-js-1.1.21.tgz",
@@ -5192,6 +5408,12 @@
         }
       }
     },
+    "node_modules/w3c-keyname": {
+      "version": "2.2.8",
+      "resolved": "https://registry.npmjs.org/w3c-keyname/-/w3c-keyname-2.2.8.tgz",
+      "integrity": "sha512-dpojBhNsCNN7T82Tm7k26A6G9ML3NkhDsnw9n/eoxSRlVBB4CEtIQ/KTCLI2Fwf3ataSXRhYFkQi3SlnFwPvPQ==",
+      "license": "MIT"
+    },
     "node_modules/w3c-xmlserializer": {
       "version": "5.0.0",
       "resolved": "https://registry.npmjs.org/w3c-xmlserializer/-/w3c-xmlserializer-5.0.0.tgz",
@@ -5401,8 +5623,10 @@
     "services/frontend": {
       "name": "@trellis/frontend",
       "dependencies": {
+        "@codemirror/lang-sql": "^6.10.0",
         "@tanstack/react-query": "^5.103.1",
         "@tanstack/react-router": "^1.170.38",
+        "@uiw/react-codemirror": "^4.25.11",
         "react": "^19.3.0",
         "react-dom": "^19.3.0",
         "react-markdown": "^10.1.0"
diff --git a/services/frontend/package.json b/services/frontend/package.json
index 5fa5991..84e29ce 100644
--- a/services/frontend/package.json
+++ b/services/frontend/package.json
@@ -10,8 +10,10 @@
     "test": "vitest run"
   },
   "dependencies": {
+    "@codemirror/lang-sql": "^6.10.0",
     "@tanstack/react-query": "^5.103.1",
     "@tanstack/react-router": "^1.170.38",
+    "@uiw/react-codemirror": "^4.25.11",
     "react": "^19.3.0",
     "react-dom": "^19.3.0",
     "react-markdown": "^10.1.0"
diff --git a/services/frontend/src/api/client.ts b/services/frontend/src/api/client.ts
index 1dcad05..8612e07 100644
--- a/services/frontend/src/api/client.ts
+++ b/services/frontend/src/api/client.ts
@@ -6,7 +6,9 @@ import type {
   HealthResponse,
   LessonCompletionResponse,
   LessonDetailResponse,
+  PracticeRunResponse,
   QuizAnswerResponse,
+  SandboxStatus,
 } from "./types";
 
 /**
@@ -92,4 +94,21 @@ export const api = {
         body: JSON.stringify({ optionId }),
       },
     ),
+
+  runPractice: (courseId: string, lessonId: string, sql: string): Promise<PracticeRunResponse> =>
+    apiFetch<PracticeRunResponse>(
+      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/practice/run`,
+      {
+        method: "POST",
+        headers: { "Content-Type": "application/json" },
+        body: JSON.stringify({ sql }),
+      },
+    ),
+
+  resetSandbox: (courseId: string, sandboxId: string): Promise<SandboxStatus> =>
+    apiFetch<SandboxStatus>(`/courses/${encodeURIComponent(courseId)}/sandbox/reset`, {
+      method: "POST",
+      headers: { "Content-Type": "application/json" },
+      body: JSON.stringify({ sandboxId }),
+    }),
 };
diff --git a/services/frontend/src/api/types.ts b/services/frontend/src/api/types.ts
index 3651963..4190bbd 100644
--- a/services/frontend/src/api/types.ts
+++ b/services/frontend/src/api/types.ts
@@ -171,3 +171,92 @@ export interface QuizAnswerResponse {
   lesson: LessonProgress;
   course: LessonCompletionResponse["course"];
 }
+
+/** One column of a practice SQL result (`practiceColumnSchema`,
+ * routes/practice.ts). `dataTypeId` is Postgres' own OID for the column's
+ * type — not rendered directly by this task's UI, kept for a future task
+ * that might want type-aware formatting. */
+export interface PracticeColumn {
+  name: string;
+  dataTypeId: number;
+}
+
+/** A successful practice run's result set (`practiceResultSchema`). Cells
+ * are always `string | null` — never numbers/objects — because the backend
+ * stringifies every value itself (bigints past 2^53, bytea, jsonb, arrays)
+ * to avoid JSON's own lossy number type; `null` means SQL NULL, never the
+ * string `"null"`. Rows are arrays positional to `columns`, not objects
+ * keyed by column name — `select 1 as a, 2 as a` is valid SQL with two
+ * columns named `a`, and an object would silently drop one. */
+export interface PracticeResultSet {
+  /** Absent for some commands (e.g. multi-statement runs where Postgres
+   * reports no command tag) — see practice/execute.ts. */
+  command?: string;
+  /** `null` when Postgres reports no row count for the command; never a
+   * placeholder `0`. */
+  rowCount: number | null;
+  columns: PracticeColumn[];
+  rows: (string | null)[][];
+  /** `true` when the result had more rows than the server's cap
+   * (`MAX_RESULT_ROWS`, 200) — `rows` holds only the first 200 in that case,
+   * while `rowCount` still reports the true total. */
+  truncated: boolean;
+  /** How many SQL statements were in the submitted text; multi-statement
+   * runs are allowed, `result`/`error` describe only the last one. */
+  statementCount: number;
+}
+
+/** Postgres' own error fields, passed through as-is
+ * (`practiceSqlErrorSchema`) — never rewritten or summarized, per the
+ * project invariant "ошибка Postgres показывается как есть". Every field
+ * but `message` may be absent (not every error carries a `hint`, etc.). */
+export interface PracticeSqlError {
+  message: string;
+  severity?: string;
+  code?: string;
+  detail?: string;
+  hint?: string;
+  /** 1-based character offset into the submitted SQL, as a string (matches
+   * `pg`'s own `position` field) — usable to place a caret in the editor. */
+  position?: string;
+  where?: string;
+}
+
+/** Whether the lesson's check query ran and, if so, what it said
+ * (`practiceCheckSchema`). `present: false` means the lesson has no check —
+ * self-marked via the existing "mark as done" control, not this. `passed`
+ * is only present when `present` is `true`. */
+export interface PracticeCheckResult {
+  present: boolean;
+  passed?: boolean;
+}
+
+/** POST /courses/:courseId/lessons/:lessonId/practice/run —
+ * routes/practice.ts's `practiceRunResponseSchema`. Always 200 for a bad
+ * SQL statement (`ok: false` + `error`, same class of decision as a wrong
+ * quiz answer) — 4xx/5xx from this endpoint mean the *request itself* was
+ * rejected (course/lesson/practice not found, a broken check query, or an
+ * unreachable sandbox), which surfaces as `ApiError`, not this shape. */
+export interface PracticeRunResponse {
+  ok: boolean;
+  /** Present iff `ok` is `true`. */
+  result?: PracticeResultSet;
+  /** Present iff `ok` is `false`. */
+  error?: PracticeSqlError;
+  durationMs: number;
+  check: PracticeCheckResult;
+  lesson: LessonProgress;
+  course: LessonCompletionResponse["course"];
+}
+
+/** GET /courses/:courseId/sandbox and POST /courses/:courseId/sandbox/reset
+ * — routes/sandbox.ts's `sandboxStatusResponseSchema`. Fields beyond
+ * `active` are only present when `active` is `true`. */
+export interface SandboxStatus {
+  active: boolean;
+  courseId?: string;
+  sandboxId?: string;
+  type?: string;
+  seedFiles?: string[];
+  readyAt?: string;
+}
diff --git a/services/frontend/src/features/lesson/LessonView.test.tsx b/services/frontend/src/features/lesson/LessonView.test.tsx
index 26973a4..34ebb6f 100644
--- a/services/frontend/src/features/lesson/LessonView.test.tsx
+++ b/services/frontend/src/features/lesson/LessonView.test.tsx
@@ -210,6 +210,27 @@ describe("LessonView", () => {
     expect(screen.getByRole("button", { name: "5" })).toBeTruthy();
   });
 
+  it("renders the practice UI for a manual-mode lesson with an ungraded practice (task 015 wiring)", async () => {
+    mockApi({
+      "/api/health": healthOk,
+      "/api/courses/c1/lessons/l1": () =>
+        jsonResponse({
+          id: "l1",
+          title: "Practice Lesson",
+          content: "Body.",
+          practice: { sandbox: "main", prompt: "Select every row from widgets." },
+        }),
+      "/api/courses/c1/progress": () => manualProgress("not_started"),
+    });
+
+    renderAt("/courses/c1/lessons/l1");
+
+    await waitFor(() => expect(screen.getByText("Select every row from widgets.")).toBeTruthy());
+    // Ungraded practice (completionMode "manual") still gets the mark-done
+    // button — running SQL alone never completes this kind of lesson.
+    expect(screen.getByRole("button", { name: "Отметить пройденным" })).toBeTruthy();
+  });
+
   it("shows a not-found message for an unknown lesson (error path)", async () => {
     mockApi({
       "/api/health": healthOk,
diff --git a/services/frontend/src/features/lesson/LessonView.tsx b/services/frontend/src/features/lesson/LessonView.tsx
index 88207e2..d14955d 100644
--- a/services/frontend/src/features/lesson/LessonView.tsx
+++ b/services/frontend/src/features/lesson/LessonView.tsx
@@ -2,6 +2,7 @@ import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
 import { Link } from "@tanstack/react-router";
 import { ApiError, api } from "../../api/client";
 import type { LessonCompletionMode } from "../../api/types";
+import { PracticeView } from "../practice/PracticeView";
 import { QuizView } from "../quiz/QuizView";
 import { Markdown } from "./Markdown";
 
@@ -91,6 +92,12 @@ export function LessonView({ courseId, lessonId }: { courseId: string; lessonId:
         // as possibly-undefined.
         <QuizView courseId={courseId} lessonId={lessonId} quiz={contentQuery.data.quiz} />
       )}
+      {contentQuery.data.practice !== undefined && (
+        // Rendered regardless of `completionMode` (unlike QuizView above) —
+        // see PracticeView's own doc comment: an unchecked practice still
+        // needs the editor, it just doesn't gate completion here.
+        <PracticeView courseId={courseId} lessonId={lessonId} practice={contentQuery.data.practice} />
+      )}
       <CompletionControl
         mode={lessonProgress.completionMode}
         isCompleted={isCompleted}
diff --git a/services/frontend/src/index.css b/services/frontend/src/index.css
index 8852c22..5a99c43 100644
--- a/services/frontend/src/index.css
+++ b/services/frontend/src/index.css
@@ -281,3 +281,120 @@ a {
   font-size: 0.85rem;
   color: var(--color-text-muted);
 }
+
+.practice-view {
+  margin: 1rem 0;
+  padding: 1rem;
+  background-color: var(--color-surface);
+  border: 1px solid var(--color-border);
+  border-radius: 0.75rem;
+}
+
+.practice-prompt {
+  margin: 0 0 0.75rem;
+}
+
+.sql-editor {
+  border: 1px solid var(--color-border);
+  border-radius: 0.5rem;
+  overflow: hidden;
+}
+
+.sql-editor .cm-editor {
+  font-size: 0.9rem;
+}
+
+.run-button {
+  display: block;
+  width: 100%;
+  background-color: var(--color-accent);
+  color: var(--color-bg);
+  border: none;
+  border-top: 1px solid var(--color-border);
+  padding: 0.6rem 1rem;
+  font-size: 0.9rem;
+  font-weight: 600;
+  cursor: pointer;
+}
+
+.run-button:disabled {
+  opacity: 0.6;
+  cursor: default;
+}
+
+.practice-result {
+  margin-top: 1rem;
+}
+
+.result-table-wrapper {
+  overflow-x: auto;
+}
+
+.result-table {
+  width: 100%;
+  border-collapse: collapse;
+  font-size: 0.85rem;
+}
+
+.result-table th,
+.result-table td {
+  padding: 0.4rem 0.6rem;
+  border: 1px solid var(--color-border);
+  text-align: left;
+  white-space: nowrap;
+}
+
+.result-table th {
+  background-color: var(--color-bg);
+}
+
+.result-null {
+  color: var(--color-text-muted);
+  font-style: italic;
+}
+
+.practice-sql-error {
+  margin: 0;
+  padding: 0.75rem 1rem;
+  background-color: var(--color-bg);
+  border: 1px solid var(--color-status-error);
+  border-radius: 0.5rem;
+  color: var(--color-status-error);
+  font-size: 0.85rem;
+  white-space: pre-wrap;
+  word-break: break-word;
+}
+
+.practice-verdict {
+  margin: 0.75rem 0 0;
+  font-weight: 600;
+}
+
+.practice-verdict--passed {
+  color: var(--color-status-ok);
+}
+
+.practice-verdict--failed {
+  color: var(--color-status-error);
+}
+
+.practice-sandbox-controls {
+  margin-top: 1rem;
+  padding-top: 0.75rem;
+  border-top: 1px solid var(--color-border);
+}
+
+.reset-sandbox-button {
+  background-color: transparent;
+  color: var(--color-text);
+  border: 1px solid var(--color-border);
+  border-radius: 0.5rem;
+  padding: 0.5rem 1rem;
+  font-size: 0.85rem;
+  cursor: pointer;
+}
+
+.reset-sandbox-button:disabled {
+  opacity: 0.6;
+  cursor: default;
+}
diff --git a/services/frontend/vite.config.ts b/services/frontend/vite.config.ts
index d61d3bc..ef0d056 100644
--- a/services/frontend/vite.config.ts
+++ b/services/frontend/vite.config.ts
@@ -24,5 +24,8 @@ export default defineConfig({
   },
   test: {
     environment: "jsdom",
+    // See src/testSetup.ts's own comment: jsdom is missing two Range
+    // methods CodeMirror (task 015's SQL editor) relies on.
+    setupFiles: ["./src/testSetup.ts"],
   },
 });
```

## Untracked files (new, not yet added)

### services/frontend/src/features/practice/PracticeView.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicPractice } from "../../api/types";
import { PracticeView } from "./PracticeView";

afterEach(() => {
  cleanup();
});

const PRACTICE: PublicPractice = { sandbox: "main", prompt: "Select every row from widgets." };
const RUN_URL = "/api/courses/c1/lessons/l1/practice/run";
const RESET_URL = "/api/courses/c1/sandbox/reset";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderView(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <PracticeView courseId="c1" lessonId="l1" practice={PRACTICE} />
    </QueryClientProvider>,
  );
  return { queryClient, container };
}

/** Types into CodeMirror's contenteditable surface — the run button stays
 * disabled for empty SQL (`SqlEditor`'s own guard), so every test that runs
 * a query needs real text in the editor first. */
async function typeSql(container: HTMLElement, text: string) {
  const editable = container.querySelector('[contenteditable="true"]') as HTMLElement;
  const user = userEvent.setup();
  await user.click(editable);
  await user.type(editable, text);
  return user;
}

function lessonCourse(completed: boolean) {
  return {
    lesson: {
      id: "l1",
      title: "Lesson",
      status: completed ? "completed" : "not_started",
      completionMode: "practice",
      hasContent: true,
      hasQuiz: false,
      hasPractice: true,
      ...(completed ? { completedAt: "2026-01-01T00:00:00.000Z" } : {}),
    },
    course: { courseId: "c1", courseVersion: "1.0.0", totalLessons: 1, completedLessons: completed ? 1 : 0, completed },
  };
}

describe("PracticeView", () => {
  it("runs the SQL, shows the result table, and reports a passing check while re-fetching progress (happy path)", async () => {
    const { queryClient, container } = renderView(async (url) => {
      expect(url).toBe(RUN_URL);
      return jsonResponse({
        ok: true,
        result: {
          command: "SELECT",
          rowCount: 1,
          columns: [{ name: "id", dataTypeId: 23 }],
          rows: [["1"]],
          truncated: false,
          statementCount: 1,
        },
        durationMs: 3,
        check: { present: true, passed: true },
        ...lessonCourse(true),
      });
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await typeSql(container, "select * from widgets;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByRole("columnheader", { name: "id" })).toBeTruthy());
    expect(screen.getByText("Проверка пройдена.")).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["courseProgress", "c1"] });
  });

  it("shows Postgres' own error text as-is for a failing statement, without touching progress (error path)", async () => {
    const { queryClient, container } = renderView(async () =>
      jsonResponse({
        ok: false,
        error: { message: 'relation "widgts" does not exist', code: "42P01", position: "15" },
        durationMs: 1,
        check: { present: false },
        ...lessonCourse(false),
      }),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const user = await typeSql(container, "select * from widgts;");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));

    await waitFor(() => expect(screen.getByText('relation "widgts" does not exist')).toBeTruthy());
    expect(screen.queryByText("Проверка пройдена.")).toBeNull();
    expect(screen.queryByText("Проверка не пройдена.")).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("resets the sandbox on request and clears the previous run's result (edge case)", async () => {
    const { container } = renderView(async (url) => {
      if (url === RUN_URL) {
        return jsonResponse({
          ok: true,
          result: { rowCount: 0, columns: [], rows: [], truncated: false, statementCount: 1 },
          durationMs: 1,
          check: { present: false },
          ...lessonCourse(false),
        });
      }
      expect(url).toBe(RESET_URL);
      return jsonResponse({
        active: true,
        courseId: "c1",
        sandboxId: "main",
        type: "postgres",
        seedFiles: [],
        readyAt: "2026-01-01T00:00:00.000Z",
      });
    });

    const user = await typeSql(container, "create table t (x int);");
    await user.click(screen.getByRole("button", { name: "Выполнить" }));
    await waitFor(() => expect(screen.getByText(/выполнена/)).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Сбросить песочницу" }));

    await waitFor(() => expect(screen.getByText("Песочница сброшена до исходного состояния.")).toBeTruthy());
    expect(screen.queryByText(/выполнена/)).toBeNull();
  });

  it("shows the backend's own error text when resetting the sandbox fails (error path)", async () => {
    renderView(async (url) => {
      expect(url).toBe(RESET_URL);
      return jsonResponse(
        { error: "seed_failed", message: "Не удалось применить seed-скрипт 02-widgets.sql" },
        500,
      );
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Сбросить песочницу" }));

    await waitFor(() =>
      expect(screen.getByText("Не удалось применить seed-скрипт 02-widgets.sql")).toBeTruthy(),
    );
  });
});
```

### services/frontend/src/features/practice/PracticeView.tsx

```
import { useState } from "react";
import { ApiError } from "../../api/client";
import type { PracticeSqlError, PublicPractice } from "../../api/types";
import { ResultTable } from "./ResultTable";
import { SqlEditor } from "./SqlEditor";
import { usePractice } from "./usePractice";

/**
 * A lesson's practice exercise: an SQL editor against the course's sandbox,
 * the raw result (or Postgres' own error text) of the last run, the check
 * query's verdict when the lesson has one, and a way to reset the sandbox
 * back to its seeded state.
 *
 * Rendered whenever the lesson carries a `practice` assignment at all —
 * not gated on `completionMode` the way `QuizView` is gated on `"quiz"`.
 * A practice without a check (`completionMode: "manual"`) still needs this
 * UI to let the learner run SQL; `LessonView`'s existing "mark as done"
 * button (unchanged by this task) is what completes that kind of lesson,
 * exactly as task-009's report describes ("Задание без check —
 * самоотметка... это уже закрывает существующий .../complete").
 */
export function PracticeView({
  courseId,
  lessonId,
  practice,
}: {
  courseId: string;
  lessonId: string;
  practice: PublicPractice;
}) {
  const [sql, setSql] = useState("");
  const { execution, isRunning, runError, run, isResetting, resetError, resetSucceeded, reset } = usePractice(
    courseId,
    lessonId,
    practice.sandbox,
  );

  return (
    <section className="practice-view">
      <p className="practice-prompt">{practice.prompt}</p>

      <SqlEditor value={sql} onChange={setSql} onRun={() => run(sql)} busy={isRunning} />
      {runError !== null && (
        <p className="muted-note">
          {runError instanceof ApiError ? runError.message : "Не удалось выполнить запрос. Попробуйте ещё раз."}
        </p>
      )}

      {execution !== undefined && (
        <div className="practice-result">
          {execution.ok
            ? execution.result !== undefined && <ResultTable result={execution.result} />
            : execution.error !== undefined && <PracticeSqlErrorView error={execution.error} />}
          {execution.check.present && (
            <p
              className={
                execution.check.passed === true
                  ? "practice-verdict practice-verdict--passed"
                  : "practice-verdict practice-verdict--failed"
              }
            >
              {execution.check.passed === true ? "Проверка пройдена." : "Проверка не пройдена."}
            </p>
          )}
        </div>
      )}

      <div className="practice-sandbox-controls">
        {/* Not gated on `isRunning`: a reset targets the sandbox itself, not
         * the in-flight run, and react-query's `MutationObserver.reset()`
         * (called by `usePractice`'s reset `onSuccess`) detaches this view's
         * run-mutation observer from whatever `Mutation` instance is still
         * executing — that instance's eventual success/error can no longer
         * reach `execution`/`runError` here, so a run finishing after a
         * reset cannot repaint a stale result over the freshly-reset
         * sandbox. Letting the learner reset without waiting out a slow
         * query is a deliberate UX choice, not an oversight. */}
        <button type="button" className="reset-sandbox-button" onClick={reset} disabled={isResetting}>
          {isResetting ? "Сбрасываем…" : "Сбросить песочницу"}
        </button>
        {resetError !== null && (
          <p className="muted-note">
            {resetError instanceof ApiError ? resetError.message : "Не удалось сбросить песочницу. Попробуйте ещё раз."}
          </p>
        )}
        {resetSucceeded && <p className="muted-note">Песочница сброшена до исходного состояния.</p>}
      </div>
    </section>
  );
}

/** Postgres' own error, verbatim — see `PracticeSqlError`'s doc comment for
 * why nothing here rewrites or summarizes it. `position` is not (yet) used
 * to place a caret in the editor; kept in the type for a later task. */
function PracticeSqlErrorView({ error }: { error: PracticeSqlError }) {
  return (
    <pre className="practice-sql-error">
      {error.message}
      {error.hint !== undefined && `\nHint: ${error.hint}`}
    </pre>
  );
}
```

### services/frontend/src/features/practice/ResultTable.test.tsx

```
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PracticeResultSet } from "../../api/types";
import { ResultTable } from "./ResultTable";

afterEach(() => {
  cleanup();
});

describe("ResultTable", () => {
  it("renders columns and rows, showing NULL cells distinctly (happy path)", () => {
    const result: PracticeResultSet = {
      command: "SELECT",
      rowCount: 2,
      columns: [
        { name: "id", dataTypeId: 23 },
        { name: "label", dataTypeId: 25 },
      ],
      rows: [
        ["1", "a"],
        ["2", null],
      ],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByRole("columnheader", { name: "id" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "label" })).toBeTruthy();
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("NULL")).toBeTruthy();
  });

  it("shows a one-line summary instead of an empty table for a command with no columns (edge case)", () => {
    const result: PracticeResultSet = {
      command: "INSERT",
      rowCount: 3,
      columns: [],
      rows: [],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByText("INSERT выполнена, затронуто строк: 3.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one header per column even when names collide (edge case, `select 1 as a, 2 as a`)", () => {
    const result: PracticeResultSet = {
      command: "SELECT",
      rowCount: 1,
      columns: [
        { name: "a", dataTypeId: 23 },
        { name: "a", dataTypeId: 23 },
      ],
      rows: [["1", "2"]],
      truncated: false,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getAllByRole("columnheader", { name: "a" })).toHaveLength(2);
  });

  it("shows a truncation note when the result was capped (edge case)", () => {
    const result: PracticeResultSet = {
      rowCount: 500,
      columns: [{ name: "n", dataTypeId: 23 }],
      rows: Array.from({ length: 200 }, (_, i) => [String(i)]),
      truncated: true,
      statementCount: 1,
    };
    render(<ResultTable result={result} />);

    expect(screen.getByText("Показаны первые 200 строк из 500.")).toBeTruthy();
  });
});
```

### services/frontend/src/features/practice/ResultTable.tsx

```
import type { PracticeResultSet } from "../../api/types";

/**
 * Renders a successful practice run's result set. Cells are already
 * strings (or `null` for SQL NULL) — `PracticeResultSet`'s own doc comment
 * explains why the backend stringifies everything itself, so this
 * component never parses/formats a cell, it only decides how `null` looks.
 *
 * A command with no columns (e.g. `CREATE TABLE`, `INSERT` without
 * `RETURNING`) has nothing to tabulate — shown as a one-line summary
 * instead of an empty table, which would look like a mistake rather than
 * "nothing to show".
 */
export function ResultTable({ result }: { result: PracticeResultSet }) {
  if (result.columns.length === 0) {
    return (
      <p className="muted-note">
        {result.command ?? "Команда"} выполнена{result.rowCount !== null && `, затронуто строк: ${result.rowCount}`}.
      </p>
    );
  }

  return (
    <div className="result-table-wrapper">
      <table className="result-table">
        <thead>
          <tr>
            {result.columns.map((column, columnIndex) => (
              // Positional index, not `column.name`: duplicate column names
              // are valid SQL (`select 1 as a, 2 as a`, per this file's own
              // doc comment above), so the name alone is not a unique key —
              // same reasoning the row/cell keys below already apply.
              <th key={columnIndex}>{column.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            // Rows have no stable id of their own (they're SQL query
            // output, not entities) — positional index is the only key
            // available, same tradeoff every ad-hoc SQL result grid makes.
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell === null ? <span className="result-null">NULL</span> : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.truncated && (
        <p className="muted-note">
          Показаны первые {result.rows.length} строк{result.rowCount !== null && ` из ${result.rowCount}`}.
        </p>
      )}
    </div>
  );
}
```

### services/frontend/src/features/practice/SqlEditor.test.tsx

```
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SqlEditor } from "./SqlEditor";

afterEach(() => {
  cleanup();
});

describe("SqlEditor", () => {
  it("renders CodeMirror's editable surface and the current value", () => {
    const { container } = render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={vi.fn()} busy={false} />);
    // CodeMirror's SQL tokenizer splits the line across several `<span>`s
    // (keyword/literal highlighting) — no single element carries the whole
    // text, so this reads the editable surface's combined text content
    // instead of matching one node.
    const editable = container.querySelector('[contenteditable="true"]');
    expect(editable?.textContent).toBe("select 1;");
  });

  it("calls onRun when the run button is clicked and enabled (happy path)", () => {
    const onRun = vi.fn();
    render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={onRun} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Выполнить" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("disables the run button when the value is empty/whitespace-only (edge case)", () => {
    render(<SqlEditor value="   " onChange={vi.fn()} onRun={vi.fn()} busy={false} />);
    expect(screen.getByRole("button", { name: "Выполнить" }).hasAttribute("disabled")).toBe(true);
  });

  it("disables the run button and shows a busy label while a run is in flight (edge case)", () => {
    render(<SqlEditor value="select 1;" onChange={vi.fn()} onRun={vi.fn()} busy={true} />);
    const button = screen.getByRole("button", { name: "Выполняем…" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
```

### services/frontend/src/features/practice/SqlEditor.tsx

```
import CodeMirror from "@uiw/react-codemirror";
import { sql } from "@codemirror/lang-sql";

/**
 * The learner's SQL input for a practice exercise. Purely controlled —
 * `PracticeView` owns the text and decides when a run is allowed; this
 * component only renders CodeMirror (SQL syntax highlighting, no schema
 * completion — the sandbox's actual tables vary per course and aren't known
 * client-side) and a "Выполнить" button.
 *
 * The run button is disabled whenever `value` is empty/whitespace-only or
 * `busy` is true (a request is already in flight) — mirrors the backend's
 * own `pattern: "\\S"` guard on the request body (routes/practice.ts), so a
 * submission that would just 400 never leaves the browser.
 */
export function SqlEditor({
  value,
  onChange,
  onRun,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const canRun = !busy && value.trim().length > 0;

  return (
    <div className="sql-editor">
      <CodeMirror
        value={value}
        height="180px"
        extensions={[sql()]}
        editable={!busy}
        onChange={onChange}
      />
      <button type="button" className="run-button" onClick={onRun} disabled={!canRun}>
        {busy ? "Выполняем…" : "Выполнить"}
      </button>
    </div>
  );
}
```

### services/frontend/src/features/practice/usePractice.ts

```
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

/**
 * Drives one lesson's practice exercise for `PracticeView`: running the
 * learner's SQL against the course's sandbox, and resetting that sandbox
 * back to its seeded state.
 *
 * `sandboxId` is the lesson's own `practice.sandbox` (`PublicPractice`) —
 * passed explicitly rather than left for the backend to infer, matching
 * `POST /courses/:courseId/sandbox/reset`'s contract that an unspecified
 * `sandboxId` only resolves when a course declares exactly one sandbox
 * (task-008's report: an omitted id on an ambiguous course 400s). The
 * lesson already names the sandbox it needs, so there is nothing to guess.
 */
export function usePractice(courseId: string, lessonId: string, sandboxId: string) {
  const queryClient = useQueryClient();

  const runMutation = useMutation({
    mutationFn: (sql: string) => api.runPractice(courseId, lessonId, sql),
    onSuccess: (data) => {
      // Only a passing check can have completed the lesson
      // (routes/practice.ts never marks it complete otherwise) — re-fetch
      // the progress tree the same way LessonView's manual-complete
      // mutation and useQuiz's correct-answer path already do, rather than
      // hand-patching the cache from this response's own `lesson`/`course`
      // fields.
      if (data.check.present && data.check.passed === true) {
        void queryClient.invalidateQueries({ queryKey: ["courseProgress", courseId] });
      }
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetSandbox(courseId, sandboxId),
    onSuccess: () => {
      // A reset wipes whatever the learner's prior attempts created —
      // the last run's result/verdict no longer describes the sandbox's
      // current state, so it must not keep being shown as if it still
      // applies to what's there now.
      runMutation.reset();
    },
  });

  return {
    /** The most recently completed run's response, or `undefined` before
     * any run (or after a reset clears it). */
    execution: runMutation.data,
    isRunning: runMutation.isPending,
    runError: runMutation.error,
    run: (sql: string) => runMutation.mutate(sql),
    isResetting: resetMutation.isPending,
    resetError: resetMutation.error,
    resetSucceeded: resetMutation.isSuccess,
    reset: () => resetMutation.mutate(),
  };
}
```

### services/frontend/src/testSetup.ts

```
// jsdom (the test environment configured in vite.config.ts) has no real
// layout engine and does not implement `Range.getClientRects()` /
// `Range.getBoundingClientRect()` at all — verified:
// `document.createRange().getClientRects` is `undefined` under the
// project's jsdom version, not a stub that just returns nothing.
// `@uiw/react-codemirror` (task 015's SQL editor) measures text geometry
// through these on every content change, scheduled via
// `requestAnimationFrame` — the resulting `TypeError` is thrown outside any
// test's own call stack (inside a jsdom-scheduled rAF callback), which
// still fails the whole `vitest run` with an "Uncaught Exception" and a
// non-zero exit code even though the test that triggered it already
// passed. The polyfill below returns an empty/zero-sized rect, which is
// fine for headless tests that never assert on pixel geometry.
if (typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = function (): DOMRectList {
    return { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
  };
}

if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
}
```

