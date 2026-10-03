# review-board

A Claude Code skill that turns a pull request, a branch, or a merge train of several PRs into one review page.
You get the file tree, the diffs, what to read first and what to check carefully, review findings pinned to their lines, test results, and the decisions you send back to the agent.
It is styled after VS Code and built around two questions per change set: what to read first, and what to check carefully.
You talk back to the agent by annotating the page in Lavish.

![A review board for a two-PR merge train](docs/screenshot.png)

## Install

Pick one.

**Claude Code plugin**, managed for you:

```
/plugin marketplace add FerreiraTiagoWebDev/review-board
/plugin install review-board@review-board
```

**Any agent** (Claude Code, Codex, Cursor and others), as editable files in your project:

```bash
npx skills@latest add FerreiraTiagoWebDev/review-board
```

You need Node 22 or newer, git, and the GitHub CLI (`gh`) signed in when reviewing PRs.
The page opens in [Lavish](https://www.npmjs.com/package/lavish-axi), which the skill runs through `npx`.

## Use

```
/review-board 1249            # one PR
/review-board feat/x          # a branch against origin/HEAD
/review-board a..b            # a git range
/review-board                 # the current branch plus uncommitted work
/review-board 1243 1246 1247  # a merge train: merges the PRs locally, reviews each, opens one PR
/review-board 1249 --full     # add code review and the repo's checks to a single PR
/review-board 1249 --restyle  # match the page to your project's design tokens
```

Installed as a plugin, the command is `/review-board:review-board`.

The skill never merges into your main branches and never pushes unless you choose to on the page.

## What ends up in your project

The first run creates a `reviews/` folder:

```
reviews/
├── skeleton.html          # the page template; commit it, edit it to restyle every review
├── pr-1249.review.json    # the review's data
└── pr-1249.html           # the page you open
```

Pages and data files carry full diffs, so the skill adds them to `.gitignore`.
Only the template is meant to be committed.

## Update

Plugin: `/plugin` → Installed → review-board → Update, or `claude plugin update review-board@review-board`.
Third-party plugins do not update on their own unless you turn on auto-update for the marketplace in `/plugin`.

skills.sh: `npx skills@latest update review-board`.

## Development

```bash
pnpm install
pnpm check        # lint, types, unit and integration tests, plugin manifest, browser tests
```

The skill itself is `skills/review-board/` and has no dependencies; everything else in the repo is tooling and tests.
Browser tests replay a recorded copy of the diff renderer from esm.sh, recorded on the first run; `LIVE_CDN=1 pnpm test:e2e` checks the real CDN.

## License

MIT.
Icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, CC BY 4.0.
