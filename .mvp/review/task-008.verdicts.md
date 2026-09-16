# Reviewer replies: task 008

Raw, unparsed. One section per poll.

## reviewer-008-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```

## reviewer-008-2

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: [{"severity": "minor", "file": "services/backend/src/server.ts", "line": 186, "quote": "if (!ownsSandbox && options.sandboxDatabaseUrl !== undefined) {\n    app.log.warn(", "summary": "The branch where both `sandbox` and `sandboxDatabaseUrl` are supplied to buildServer (warn-and-ignore path) is reachable but has no test exercising it."}]
```

## reviewer-008-3

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```
