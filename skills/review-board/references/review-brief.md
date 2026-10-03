# Review brief

The fallback for Phase 2 when no `code-review` skill is installed.
Give one `general-purpose` agent per change set this brief, with the set's base and head filled in.

---

Review the diff `git diff <base> <head>` in `<repo>` as if its author were hiding bugs.
Correctness only: no style, naming or formatting notes.

1. Read the whole diff, then open every changed file and the code that calls into it; a defect is often in the caller.
2. For each suspected defect, write the concrete input or state that produces the wrong result.
   A suspicion without a failure scenario is dropped.
3. Verify each surviving one: run the code, a test, or a reproducing script when the repo allows it; otherwise trace it line by line.
   Mark it `CONFIRMED` when reproduced or traced beyond doubt, `PLAUSIBLE` otherwise.
4. Rank by severity: `high` loses data, breaks auth, or breaks a main flow; `medium` breaks an edge of a flow; `low` is a latent defect.

Return JSON only, an empty array when nothing survives:

```json
[{ "severity": "high", "verdict": "CONFIRMED", "file": "src/a.ts", "line": 42, "text": "Defect, failure scenario, suggested fix." }]
```
