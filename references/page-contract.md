# Page contract

What the review board page must do, and how it is produced.
The skeleton in `assets/skeleton.html` already satisfies every point below; `scripts/build.mjs` only fills it with data.

## Files in the project

`scripts/init.mjs` creates `reviews/` once per project:

| File                         | Written by      | Purpose                                                                 |
| ---------------------------- | --------------- | ----------------------------------------------------------------------- |
| `reviews/skeleton.html`      | init, then you  | the reusable page: markup, CSS, behaviour, an empty data placeholder     |
| `reviews/<slug>.review.json` | orchestrator    | the sidecar: scope, change sets, curation, phases, usage                 |
| `reviews/<slug>.html`        | build           | the filled page, opened in Lavish; never hand-edited                     |

`init.mjs` also adds `reviews/*.html`, `!reviews/skeleton.html` and `reviews/*.review.json` to the project's `.gitignore`: generated pages carry full diffs and stay local, the skeleton is shared.

### The sidecar

```json
{
  "slug": "pr-1249",
  "title": "PR #1249 feat/x → develop",
  "lead": "One paragraph for the top of the page.",
  "repo": "/abs/path/to/repo (optional, defaults to the parent of reviews/)",
  "mode": "train | pr | branch | range | worktree",
  "depth": "full | light",
  "base": "origin/develop",
  "head": "refs/review-board/pr-1249",
  "train": { "base": "origin/develop", "head": "chore/merge-train-2026-10-02" },
  "changeSets": [
    { "id": "1249", "kind": "pr", "label": "#1249 feat/x", "pr": 1249, "branch": "feat/x", "base": "<merge-base sha>", "head": "<head sha>" },
    { "id": "worktree", "kind": "worktree", "label": "Working tree", "base": "HEAD" }
  ],
  "curation": { "sets": {}, "verification": null, "decisions": [], "tierRules": {} },
  "sessionId": "<claude session id>",
  "transcript": "~/.claude/projects/<encoded cwd>/<session id>.jsonl",
  "phases": [],
  "usage": null
}
```

- `train` derives one change set per first-parent merge commit (`merge: #N <branch> into merge train`), base = merge-base of the two parents, head = second parent, so a stacked PR shows only its delta.
  Consecutive non-merge commits on the train become one `fixes` set.
- `changeSets` are appended after the derived ones. `kind: worktree` diffs the working tree against `base` and includes untracked files; an empty worktree set is dropped.
- `curation` follows `curation.md`.
- `phases` and `usage` are managed by `scripts/usage.mjs`.

### The skeleton

A single HTML file: `<style>` with a `:root` block of CSS variables, the behaviour as one `<script type="module">`, and the placeholder

```html
<script id="review-data" type="application/json">{...}</script>
```

whose content the build replaces with the page data (and `<title>` with the review title).
The Shiki pair sits at the top of the script (`const THEME = { light, dark }`).
Edit `:root` and `THEME` to restyle every review in a project; never edit the placeholder or the behaviour by hand.
The default is VS Code Dark Modern: editor `#1f1f1f`, sidebar `#181818`, text `#cccccc`, accent `#0078d4`, links `#4daafc`, git decorations amber/green/red, Shiki `dark-plus`/`light-plus`, split diffs on viewports of 1200px and wider.

## Behaviour the page must keep

Navigation, all native `<button>` or rows marked `data-lavish-action` so Lavish lets the click act instead of annotating:

- Change-set strip and list (only when more than one set), tier chips, VS Code style compact folder tree with collapse, keyboard up/down/Enter.
- The set card is a briefing, not a text block: tier chips that filter the tree; **Read first** (curated core order with notes, or an automatic suggestion ranked by path risk and churn when the board has no curation); **Check carefully** (files flagged by the generator: schema and migrations, auth and secrets, API surface, infra, config, deletions, large changes; a curation `flags` array overrides); **Findings** by severity with a jump to the batch; **Needs a human** (pending decisions, failing checks, protected areas, deletions, uncommitted work, light-board notice). The PR description and a train's fix commits sit behind disclosures. Every file in it opens the diff.
- Start-here list and every finding reference open the file's diff.
- Unified/split toggle; `@pierre/diffs` renders every diff (`processPatch` + `FileDiff`), never a `<pre>`.

Asking, so every piece of information can be questioned with its context attached:

- An **Ask** button beside every set summary, file header, finding (in the card, pinned on the diff line, and in the batch table) and verification row.
  It opens an inline textarea and queues exactly one prompt tagged `question` carrying `{ what, set, file, line, finding, quote, question }`.
- **Selecting code** in the diff, by dragging over the text or by clicking line numbers (`enableLineSelection`, `onLineSelected`), shows a floating toolbar under the selection with the file and line range, *Ask about this* and *Request change*; both carry `{ file, side, start, end, code }` where `code` is the selected text, tag `question` or `change-request`. The diff renders in a shadow root; the mapping reads `data-line`, `data-alt-line` and `data-line-type` on the content rows.
- Findings pin to their diff line through `lineAnnotations` + `renderAnnotation`.

Deciding:

- All findings form **one tracked batch** (`data-lavish-question="findings"`): a disposition select per finding (`fix`, `accept`, `defer`) and an optional note, queued once with `data.items` listing every id; the submit refuses until every finding has a disposition.
- Flow decisions are radio forms, one prompt each, queued on submit only, never on change; selected and queued states are shown apart.
- *Copy all answers* works without Lavish; without Lavish every submit shows the prompt text inline instead.

Layout:

- Explicit page background and readable text so a double-clicked file renders; the esm.sh import needs network, which is fine.
- No horizontal overflow at any nesting level: `min-width: 0`, `minmax(0, 1fr)`, `overflow-wrap: anywhere`, filenames ellipsised with the full path in `title`.
- Phone width stacks the panes.
- Set summaries render light markdown (headings, bullet and numbered lists, bold, inline code, links), so a PR body pasted as the summary reads as written; everything else is plain text, HTML-escaped.
- Footer shows build time, and wall time plus tokens per phase when `usage.json` exists.

## Restyle brief (`--restyle` only)

Spawn one `general-purpose` agent, `model: opus`, `run_in_background: false`, with:

- the path of `reviews/skeleton.html` and the repo path;
- Lavish's design priority, fetched at run time (`npx -y lavish-axi design`, `playbook code`): the user's stated look first, else the repo's design tokens (CSS custom properties, Tailwind theme, brand file), else leave the VS Code default;
- the instruction to change only the `:root` variables and the `THEME` Shiki pair, keep every variable name, keep contrast at or above 4.5:1 for text on `--bg` and `--side`, and never touch the data placeholder, the markup or the behaviour;
- the instruction to report the token values chosen, their sources, and the Shiki pair with its reason.

Rebuild after the restyle and check the page in a headless browser before opening it.
