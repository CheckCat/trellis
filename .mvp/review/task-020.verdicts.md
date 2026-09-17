# Reviewer replies: task 020

Raw, unparsed. One section per poll.

## reviewer-020-1

```
VERDICT: approve
CANNOT_VERIFY: none
FINDINGS: []
```

## reviewer-020-2

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "pattern-violation", "file": "scripts/check-text-sources.mjs", "line": 31, "quote": "const EXCLUDED_PREFIXES = ['.mvp/'];", "summary": "The gate excludes the entire .mvp/ tree from the NUL-byte check, contradicting the brief's literal requirement that 'ни один отслеживаемый исходник' (not a single tracked file) contain non-text bytes; two currently-tracked files (.mvp/review/task-007.md, .mvp/review/task-010.md) genuinely contain NUL bytes and pass the gate silently as a result — the implementer's own report documents this deliberately, but a stated rationale does not downgrade the severity of contradicting a brief-stated rule."}]
```

## reviewer-020-3

```
VERDICT: request-changes
CANNOT_VERIFY: none
FINDINGS: [{"severity": "pattern-violation", "file": "scripts/check-text-sources.mjs", "line": 74, "quote": "const EXCLUDED_PREFIXES = ['.mvp/'];", "summary": "Гейт исключает весь каталог .mvp/ из проверки, хотя бриф требует «ни один отслеживаемый исходник не содержит не-текстовых байт» без оговорок об исключениях."}]
```
