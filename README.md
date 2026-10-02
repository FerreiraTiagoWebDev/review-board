# review-board

A Claude Code skill that turns a pull request, a branch, a git range, the working tree or a merge train of several PRs into a visual review board: a Source Control style page with the file tree on the left, the diff on the right, a briefing of what to read first and check carefully, code-review findings pinned to their lines, verification results, and decisions you queue back to the agent.
The page opens in [Lavish](https://www.npmjs.com/package/lavish-axi), so everything you select, annotate or answer flows back into the Claude Code session that built it.

## Install

As a personal skill, available in every project:

```bash
git clone https://github.com/FerreiraTiagoWebDev/review-board ~/.claude/skills/review-board
```

Or as a plugin:

```bash
claude plugin marketplace add FerreiraTiagoWebDev/review-board
claude plugin install review-board@review-board
```

Requirements: Node 22, git, the GitHub CLI (`gh`) signed in for PR modes, and network access for the diff renderer loaded from esm.sh.

## Use

```
/review-board 1249            # one PR, light: tree, diffs, briefing from the PR description
/review-board feat/x          # a branch against origin/HEAD
/review-board a..b            # a git range
/review-board                 # the current branch, plus the dirty working tree
/review-board 1243 1246 1247  # a merge train: branch, ordered merges, code review per PR, repo gates, one PR to the base
/review-board 1249 --full     # code review and verification on a single target
/review-board 1249 --restyle  # also adapt the skeleton to the project's design system
```

The first run in a project creates `reviews/`:

```
reviews/
├── skeleton.html          # the reusable page; edit it to restyle every review in this project
├── pr-1249.review.json    # the sidecar: scope, change sets, curation, phases, usage
└── pr-1249.html           # the filled page, opened in Lavish
```

Generated pages and sidecars carry full diffs and review notes, so `init` gitignores them; only the skeleton is meant to be committed.

## What the page does

- File tree with VS Code's compact folders, git status colours, tiers (core, supporting, tests, generated), a viewed checkbox per file, keyboard navigation.
- Briefing per change set: read first, check carefully (schema, auth, API, config, infra, deletions), findings by severity, what needs a human; the PR description behind a disclosure.
- Diffs rendered with `@pierre/diffs`, unified or split; select code or click line numbers to ask a question or request a change with the exact lines attached.
- Every summary, note, finding and verification row has an Ask control that sends a prompt with its context.
- Findings form one tracked batch with a disposition each (fix now, accept, defer to an issue); flow decisions are radio forms; everything works without Lavish too, as copyable text.
- Footer with wall time and tokens per phase, measured from the session transcript.

## Styling

The default look is VS Code Dark Modern.
Change the `:root` variables and the Shiki pair at the top of `reviews/skeleton.html` to restyle, or run with `--restyle` to let the skill derive them from your project's design tokens.

## Layout of this repository

```
SKILL.md                 # the skill
references/              # curation schema, page contract, train mechanics
scripts/init.mjs         # creates reviews/ in a project
scripts/build.mjs        # fills the skeleton from git + the sidecar
scripts/usage.mjs        # phase marks and the token/time report
assets/skeleton.html     # the default skeleton
.claude-plugin/          # plugin and marketplace manifests
```

## License

MIT
