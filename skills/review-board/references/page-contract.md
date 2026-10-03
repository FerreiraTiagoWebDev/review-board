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
  "transcript": "optional, defaults to ~/.claude/projects/<repo path with non-alphanumerics as ->/<sessionId>.jsonl",
  "phases": [],
  "usage": null
}
```

- `train` derives one change set per first-parent merge commit (`merge: #N <branch> into merge train`), base = merge-base of the two parents, head = second parent, so a stacked PR shows only its delta.
  Consecutive non-merge commits on the train become one `fixes` set.
- `changeSets` are appended after the derived ones. `kind: worktree` diffs the working tree against `base` and includes untracked files; an empty worktree set is dropped.
- `curation` follows `curation.md`.
- Change set ids use letters, digits, `.`, `_` and `-` only.
- `build.mjs` validates the sidecar before touching git and lists every problem at once; a ref that is not a commit is named; nothing is written until both pass.
- A `worktree` set leaves out the `reviews/` directory itself.
- `phases` and `usage` are managed by `scripts/usage.mjs`.

### The skeleton

A single HTML file: `<style>` with a `:root` block of CSS variables, the behaviour as one `<script type="module">`, and the placeholder

```html
<script id="review-data" type="application/json">{...}</script>
```

whose content the build replaces with the page data (and `<title>` with the review title).
The Shiki pair sits at the top of the script (`const THEME = { light, dark }`).
Edit `:root` and `THEME` to restyle every review in a project; never edit the placeholder or the behaviour by hand.
The default is VS Code Dark Modern, token for token: editor `#1f1f1f`, side bar, tabs, panel and status bar `#181818`, text `#cccccc`, accent `#0078d4`, links `#4daafc`, git decorations amber/green/red, Shiki `dark-plus`/`light-plus`, split diffs on viewports of 1200px and wider.
Icons are Codicons (Microsoft, CC BY 4.0), inlined as SVG paths in the `ICONS` object.

## Behaviour the page must keep

The page answers two questions per change set, what to read first and what to check carefully, and keeps everything else quiet.
It is fixed to the viewport on desktop (header, side bar, editor, status bar), stacked into one scrolling document under 900px, and styled after VS Code without copying VS Code behaviours that do not serve a review.
It has no forms of its own: the reviewer talks to the agent through Lavish annotations on what they see, so every finding, decision option, check and file reference is a plain, annotatable element with its id in its text.
Navigation controls are native `<button>`s, or rows and tabs marked `data-lavish-action` so Lavish lets the click act instead of annotating.

Header (at most ~70px): the title, the lead paragraph, and when there is more than one set a row of chips (All, then one per set: number, branch, files, findings) that selects the set for the tree and the Overview.

Side bar: the files as collapsible groups by tier (Core "read first", Supporting, Tests & generated, the last one collapsed by default), each a compact folder tree.
File rows carry the viewed checkbox, the name coloured by git status (modified amber, added green, deleted red and struck through, renamed green), core files in bold, tests and generated files dimmed, a findings badge, the set badge on the "All" view, and the status letter.
Keyboard: up/down move the cursor, Enter or Space opens, `v` toggles viewed.

Editor: an **Overview** tab and at most one file tab (the file last opened; × or the Overview tab returns).
For a file, a line under the tabs carries its risk flags (schema, auth, API, infra, config, deletion, large change), its curated note, status, tier and `+n −n`; editor actions are mark viewed and unified/split.
Diffs render with `@pierre/diffs` (`processPatch` + `FileDiff`, `disableFileHeader`, `diffIndicators: "none"`, Menlo 12px/18px), never a `<pre>`; findings pin to their diff line through `lineAnnotations` + `renderAnnotation` as editor-widget notes carrying the id.

Overview, per set: heading, a meta line (title, kind, files, stats), then two sections side by side:

- **Read first**: the core files numbered in the curated order with their notes, or, without curation, the reviewable files ranked by path risk and size.
- **Check carefully**: one entry per risky file, ordered by its worst finding then path risk: the file, its flag labels, and its findings beneath (severity icon, id, `line n` link that opens the diff at the annotation, full text). Findings without a file follow. A light board says that code review was not run; a clean full board says so too.

Description and commits sit behind disclosures. Board-level sections follow the sets: **Checks** (one row per check with a pass/fail icon, command and result) and **Decisions** (each with its id, title and numbered options).

Status bar: mode and depth, head ref with base → head shas, findings by severity (returns to the Overview), the selection hint while a file is open, viewed count, usage and build time.

Selecting code, the one thing Lavish cannot annotate itself because the diff lives in a shadow root: dragging over diff text or clicking line numbers (`enableLineSelection`, `onLineSelected`) shows a floating toolbar under the selection with the file and line range, *Ask about this* and *Request change*; both open an inline textarea and queue exactly one prompt carrying `{ what, set, file, side, start, end, code, question }`, tag `question` or `change-request`. The mapping reads `data-line`, `data-alt-line` and `data-line-type` on the content rows. Without Lavish the prompt text shows inline instead.

Layout:

- Explicit page background and readable text so a double-clicked file renders; the esm.sh import needs network, which is fine.
- No horizontal overflow at any nesting level: `min-width: 0`, `minmax(0, 1fr)`, `overflow-wrap: anywhere`, filenames ellipsised with the full path in `title`.
- Set summaries render light markdown (headings, bullet and numbered lists, bold, inline code, links), so a PR body pasted as the summary reads as written; everything else is plain text, HTML-escaped.

## Restyle brief (`--restyle` only)

Spawn one `general-purpose` agent, `model: opus`, `run_in_background: false`, with:

- the path of `reviews/skeleton.html` and the repo path;
- Lavish's design priority, fetched at run time (`npx -y lavish-axi design`, `playbook code`): the user's stated look first, else the repo's design tokens (CSS custom properties, Tailwind theme, brand file), else leave the VS Code default;
- the instruction to change only the `:root` variables and the `THEME` Shiki pair, keep every variable name, keep contrast at or above 4.5:1 for text on `--bg` and `--side`, and never touch the data placeholder, the `ICONS` object, the markup or the behaviour;
- the instruction to report the token values chosen, their sources, and the Shiki pair with its reason.

Rebuild after the restyle and check the page in a headless browser before opening it.
