# Curation

The editorial content of a review board, stored under `curation` in the sidecar `reviews/<slug>.review.json`.
`scripts/build.mjs` merges it with the git data of the sidecar's change sets.
Everything a reader sees that is not a diff comes from here.
Edit it and rerun the build; never edit the generated page.

## Shape

```json
{
  "title": "Merge train → develop",
  "lead": "One paragraph for the top of the page: what this board is and what state the branch is in.",
  "sets": {
    "<change set id>": {
      "title": "Short imperative title",
      "summary": "What this change set does and why, 2-4 sentences, in the reader's words.",
      "findings": [
        {
          "id": "1247-F1",
          "severity": "medium",
          "verdict": "PLAUSIBLE",
          "file": "apps/website/src/components/player/mini-player/hooks/useResizablePanelHeight.ts",
          "line": 49,
          "text": "Verbatim finding text from /code-review: defect, repro, fix."
        }
      ],
      "files": {
        "apps/website/src/components/player/mini-player/hooks/useResizablePanelHeight.ts": {
          "tier": "core",
          "note": "One line: what this file does in the change and why to read it. Mandatory for core."
        },
        "apps/website/src/components/player/mini-player/constants.ts": { "tier": "supporting", "note": "Optional." },
        "apps/admin/src/routeTree.gen.ts": { "tier": "generated", "note": "Auto-generated. Never hand-edited." },
        "apps/backend/src/env/index.ts": { "tier": "supporting", "flags": ["config", "auth"] }
      }
    }
  },
  "tierRules": {
    "tests": "\\.spec\\.|\\.test\\.|/test/",
    "generated": "(\\.gen\\.ts|\\.snap|\\.generated\\.json|pnpm-lock\\.yaml)$"
  },
  "verification": {
    "lead": "Which tree these results were measured on and when.",
    "rows": [
      { "check": "pnpm lint:check", "result": "pass" },
      { "check": "pnpm test all", "result": "pass" },
      { "check": "pnpm backend:test:integration", "result": "1 fail, pre-existing on develop: <what>" }
    ]
  },
  "decisions": [
    { "id": "D1", "title": "Push the branch and open one PR to develop", "options": ["Push and open the PR now", "Wait for the findings batch first"] }
  ]
}
```

## Rules

- **Change set ids** match the sidecar (`changeSets[].id`) or, for a train, the PR number parsed from the merge subject.
  A set without a curation entry still renders: label as title, no summary, rule-based tiers.
- **Tiers**: `core`, `supporting`, `tests`, `generated`.
  A listed file takes its tier; unlisted files fall to `tierRules` (`tests`, `generated`) then `supporting`.
  `tierRules` are optional; the defaults cover `.spec.`, `.test.`, `/test/`, `__tests__`, `.gen.ts`, `.snap`, `.generated.json` and lockfiles.
- **Core files define the reading order**: "Start here" lists them in the order they appear under `files`.
  Start where the logic starts and follow the dependency direction (schema → service → API → UI).
  Every core file carries a `note`.
- **Flags** are computed from the path (`schema`, `auth`, `api`, `config`, `infra`, `agent`, `deleted`, `large`) and drive "Check carefully"; a `flags` array on a file replaces the computed ones.
- **Findings are verbatim** from `/code-review`: do not soften or summarise.
  `severity` is `low`, `medium` or `high`; `verdict` is `CONFIRMED` or `PLAUSIBLE`.
  `id` is optional and defaults to `<set id>-F<n>`; once the board is open, never renumber, the reviewer's batch answers reference these ids.
  `file` + `line` pin the finding on the diff; a file outside the change set still renders, unlinked.
- **Verification rows** state the exact command and the exact result.
  `pass` renders green; anything containing `fail` or `error` renders amber; other text renders plain.
  Omit the block in light mode.
- **Decisions** are flow questions only (push, open PR, do the config fix).
  Finding dispositions are not decisions: the page builds the tracked batch from `findings` itself.
- **Summaries describe behaviour, not files**: say what changed for the user or the system, and why; the tree already shows which files.
- Write every sentence as if the reader has not seen the branch; this page is often read the next morning.
