# Reviewer replies: task 009

Raw, unparsed. One section per poll.

## reviewer-009-1

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "bug", "file": "services/backend/src/practice/execute.ts", "line": 120, "quote": "} catch (err) {\n    return { ok: false, error: toPracticeSqlError(err), durationMs: clock() - startedAt };", "summary": "executePracticeSql's own docstring (lines 93-98: \"It only propagates failures that are not the statement's fault (the connection dying mid-query, say), which the route turns into a sandbox-level answer\") promises non-statement failures propagate, but the catch-all here swallows every error unconditionally, so a dropped sandbox connection mid-query is reported to the learner as HTTP 200 'your SQL failed' instead of a 503 sandbox-unavailable answer, and — since the same client is then reused for runPracticeCheck (practice/check.ts) — the outage can also surface as `check_failed` ('the course author's check SQL is broken'), misattributing an infrastructure fault to user/course content."}]
```

## reviewer-009-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```

## reviewer-009-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/backend/src/practice/execute.ts", "line": 120, "quote": "} catch (err) {\n    return { ok: false, error: toPracticeSqlError(err), durationMs: clock() - startedAt };\n  }", "summary": "The function's own docstring (lines 93-98) says it 'only propagates failures that are not the statement's fault (the connection dying mid-query, say), which the route turns into a sandbox-level answer', but the catch block has no such distinction — it unconditionally swallows every error from client.query (SQL errors and non-SQL failures like a dropped connection alike) into {ok:false}, so a genuine connection failure would surface as a 200 'your SQL is wrong' response (and, downstream, the following rollback/check calls on the same dead client would likely get misclassified as check_failed/422 'broken course content') instead of the 503 sandbox-unavailable answer the comment describes."}]
```
