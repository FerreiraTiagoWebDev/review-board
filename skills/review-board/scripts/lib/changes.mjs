import { splitNul } from './git.mjs';

export const MERGE_SUBJECT = /^merge: #(\d+) (\S+) into (?:merge )?train$/;

/**
 * @typedef {{ status: string, path: string, oldPath?: string }} NameStatus
 * @typedef {{ adds: number, dels: number, binary: boolean }} Stat
 * @typedef {{ sha: string, subject: string, parents: string[] }} Commit
 */

/** @param {string} text output of `git diff --name-status -z` */
export function parseNameStatus(text) {
  const parts = splitNul(text);
  /** @type {NameStatus[]} */
  const entries = [];
  for (let index = 0; index < parts.length; ) {
    const code = parts[index++];
    const status = code[0];
    if (status === 'R' || status === 'C') {
      const oldPath = parts[index++];
      const path = parts[index++];
      entries.push(status === 'R' ? { status: 'R', oldPath, path } : { status: 'A', path });
    } else entries.push({ status, path: parts[index++] });
  }
  return entries;
}

/** @param {string} text output of `git diff --numstat -z` */
export function parseNumstat(text) {
  const parts = splitNul(text);
  /** @type {Map<string, Stat>} */
  const stats = new Map();
  for (let index = 0; index < parts.length; ) {
    const [adds, dels, inlinePath] = parts[index++].split('\t');
    let path = inlinePath;
    if (path === '') {
      index++;
      path = parts[index++];
    }
    const binary = adds === '-';
    stats.set(path, { adds: binary ? 0 : Number(adds), dels: binary ? 0 : Number(dels), binary });
  }
  return stats;
}

/** @param {string} text output of `git rev-list --format=%H%x00%P%x00%s` */
export function parseCommits(text) {
  return text
    .split('\n')
    .filter((line) => line.includes('\0'))
    .map((line) => {
      const [sha, parents, subject] = line.split('\0');
      return { sha, subject, parents: parents ? parents.split(' ') : [] };
    });
}

/** @param {import('./git.mjs').Git} git */
export function firstParentCommits(git, base, head) {
  return parseCommits(git(['rev-list', '--first-parent', '--reverse', '--format=%H%x00%P%x00%s', `${base}..${head}`]));
}

const short = (sha) => sha.slice(0, 7);

/**
 * @param {Commit} commit
 * @param {string} base merge-base of the two parents
 */
export function mergeSet(commit, base) {
  const head = commit.parents[1];
  const match = MERGE_SUBJECT.exec(commit.subject);
  return match
    ? { id: match[1], kind: 'merge', label: `#${match[1]} ${match[2]}`, pr: Number(match[1]), branch: match[2], base, head }
    : { id: short(commit.sha), kind: 'merge', label: commit.subject, base, head };
}

/** @param {Commit[]} commits */
export function fixesSet(commits) {
  const first = commits[0];
  const last = commits[commits.length - 1];
  return {
    id: commits.length === 1 ? short(first.sha) : `fixes-${short(first.sha)}`,
    kind: 'fixes',
    label: commits.length === 1 ? first.subject : `Fixes (${commits.length} commits)`,
    commits: commits.map((commit) => ({ sha: short(commit.sha), subject: commit.subject })),
    base: first.parents[0],
    head: last.sha,
  };
}

/**
 * Splits a train's first-parent history into one set per merge and one per run of plain commits.
 * @param {Commit[]} commits
 * @param {(a: string, b: string) => string} mergeBase
 */
export function groupTrain(commits, mergeBase) {
  const sets = [];
  /** @type {Commit[]} */
  let pending = [];
  const flush = () => {
    if (pending.length) sets.push(fixesSet(pending));
    pending = [];
  };
  for (const commit of commits) {
    if (commit.parents.length > 1) {
      flush();
      sets.push(mergeSet(commit, mergeBase(commit.parents[0], commit.parents[1])));
    } else pending.push(commit);
  }
  flush();
  return sets;
}

export function trainSets(git, train) {
  const mergeBase = (a, b) => git(['merge-base', a, b]).trim();
  return groupTrain(firstParentCommits(git, train.base, train.head), mergeBase);
}

const diffRange = (set) => (set.kind === 'worktree' ? [set.base ?? 'HEAD'] : [set.base, set.head]);

const excludeSpecs = (excludes) => (excludes.length ? ['--', '.', ...excludes.map((path) => `:(exclude)${path}`)] : []);

/** @param {import('./git.mjs').Git} git @param {string[]} [excludes] paths left out of the listing */
export function trackedEntries(git, set, excludes = []) {
  const range = diffRange(set);
  const names = parseNameStatus(git(['diff', '--name-status', '-z', '-M', ...range, ...excludeSpecs(excludes)]));
  const stats = parseNumstat(git(['diff', '--numstat', '-z', '-M', ...range, ...excludeSpecs(excludes)]));
  return names.map((entry) => ({
    entry,
    stat: stats.get(entry.path) ?? { adds: 0, dels: 0, binary: false },
    patch: () => git(['diff', '-M', ...range, '--', ...(entry.oldPath ? [entry.oldPath, entry.path] : [entry.path])]),
  }));
}

/** @param {import('./git.mjs').Git} git @param {string[]} [excludes] paths left out of the listing */
export function untrackedEntries(git, excludes = []) {
  const noIndex = (extra, path) => git(['diff', '--no-index', ...extra, '--', '/dev/null', path], { okStatus: [0, 1] });
  return splitNul(git(['ls-files', '--others', '--exclude-standard', '-z', ...excludeSpecs(excludes)])).map((path) => {
    const stat = parseNumstat(noIndex(['--numstat', '-z'], path))
      .values()
      .next().value ?? { adds: 0, dels: 0, binary: false };
    return { entry: { status: 'A', path }, stat, patch: () => noIndex([], path) };
  });
}
