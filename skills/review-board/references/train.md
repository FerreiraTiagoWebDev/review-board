# Train mechanics and acting on answers

## Building the train

Preconditions: clean worktree or an explicit list of what may stay dirty; `gh auth status` green; `git symbolic-ref refs/remotes/origin/HEAD` names the integration branch (fix with `git remote set-head origin <branch>` if it reads `main` in a repo whose base is `develop`).

1. `git fetch origin --quiet`, then for every PR: `gh pr view <n> --json number,title,body,headRefName,headRefOid,baseRefName,mergeable,mergeStateStatus`.
   A PR whose base is not the integration branch, or that is not mergeable, stops the train with a message; it is the user's call.
2. Order: the order given by the user; else the PR descriptions if they prescribe one; else by PR creation date.
   Stacked PRs: `git merge-base --is-ancestor <head of A> <head of B>` means B contains A, so A goes first and B's set shows only its delta.
3. Dry run every merge before touching the branch: `git merge-tree --write-tree <base> <head>` on the accumulated tree; a conflict stops before any merge happens.
4. Branch: `git checkout -b chore/merge-train-<YYYY-MM-DD> origin/<integration branch>`; reuse the branch if it already exists for today.
5. Merge each PR, in order, with exactly this subject so `build.mjs` can parse it:

   ```bash
   git merge --no-ff --no-edit -m "merge: #<n> <headRefName> into merge train" origin/<headRefName>
   ```

6. After each merge: rerun the Phase 5 build so the open page gains the step, then run the Phase 2 review for that PR and transcribe its findings into the sidecar's curation.

Nothing is pushed during this. The train is local until the push decision.

## Verifying the stack

Run the repo's gates on the exact tree under review, in a worktree so the user's checkout stays untouched:

```bash
git worktree add <scratch>/train <train branch>
```

Install there if the repo needs it, run the gates the repo's `CLAUDE.md` names (lint, typecheck, unit, integration, build), fall back to `package.json` scripts, and record each command with its exact outcome as a `verification.rows` entry.
A failing check is compared against the base branch: a failure that reproduces on the base is reported as pre-existing, with the cause when known, and never silently excluded.
Remove the worktree when done: `git worktree remove <scratch>/train`.
`verification.lead` states the tree sha the rows were measured on.

## Acting on finding dispositions

Dispositions arrive as Lavish annotations on finding rows (Overview list, diff annotation), each carrying the finding id in its text; one delivery may hold several.
Every finding the reviewer addressed gets exactly one outcome in the receipt:

- **fix**: one commit per finding on the train or reviewed branch, subject `fix: <what> (<finding id>)`, with the proving test rerun; the tier of the touched files does not change.
  After the last fix: rebuild the page (fix commits appear as a `fixes` set on a train; for other modes append `{ "id": "fixes", "kind": "fixes", "base": "<pre-fix head>", "head": "<new head>" }` to the sidecar's `changeSets`), rerun the failing checks, update `verification.rows`.
- **defer**: `gh issue create --title "<finding one-liner>" --body "<file>:<line>\n\n<finding text>\n\nFrom review of #<pr> on <date>."`; put the issue URL in the receipt and in the finding's `text` suffix so the page links it after the next build.
- **accept**: listed as accepted with the reviewer's note.

Compare the ids the reviewer addressed with the receipt before reporting; a missing id is a bug in the receipt, not in the page. Findings nobody addressed are listed as still open.

## Questions and change requests

- `question`: answer in chat and with `npx -y lavish-axi reply reviews/<slug>.html --agent-reply "<answer>"`; read the quoted code, file and line range in `data` (or the annotated element's text for a plain annotation) before answering, and open the file when the answer depends on code the quote does not show.
- `change-request`: make the change on the reviewed branch as its own commit, rerun the proving test, rebuild the page, reply with the commit sha and what changed. A change request that would alter behaviour beyond the quoted lines is answered with a question first.

## Push and PR

Only on the explicit decision:

```bash
git push -u origin <branch>
gh pr create --base <integration branch> --head <branch> --title "<title>" --body "<body>"
```

The body lists the PRs the train carries in order, the findings with their dispositions and issue links, and the verification table.
The PR opens and stops there.
Never merge into the integration branch, `staging` or `main`, and never run a merge with the repo's auto-merge tooling; a human merges.
