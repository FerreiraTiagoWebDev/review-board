import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { build } from '../../skills/review-board/scripts/build.mjs';
import { makeRepo, pageData, SCRIPTS, writeSidecar } from '../helpers/repo.mjs';

const lines = (count, prefix = 'line') => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n') + '\n';
const fileOf = (set, path) => {
  const file = set.files.find((entry) => entry.path === path);
  assert.ok(file, `${path} not in ${set.files.map((entry) => entry.path).join(', ')}`);
  return file;
};

function branchRepo(t) {
  const repo = makeRepo(t);
  repo.write('src/keep.ts', lines(5));
  repo.write('src/old-name.ts', lines(40, 'stable'));
  repo.write('src/gone.ts', 'export const gone = 1;\n');
  repo.write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
  const base = repo.commit('base');
  repo.git('checkout', '--quiet', '-b', 'feat/x');
  repo.write('src/keep.ts', lines(5).replace('line 3', 'line three'));
  repo.git('mv', 'src/old-name.ts', 'src/new name é.ts');
  repo.git('rm', '--quiet', 'src/gone.ts');
  repo.write('src/auth/session.ts', 'export const ttl = 60;\n');
  repo.write('src/auth/session.test.ts', 'test("ttl", () => {});\n');
  repo.write('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0xff]));
  repo.write('pnpm-lock.yaml', lines(8000, 'resolution'));
  const head = repo.commit('feat: x');
  return { repo, base, head };
}

describe('build: branch', () => {
  test('every kind of change lands in the page with stats, tiers, flags and patches', (t) => {
    const { repo, base, head } = branchRepo(t);
    const sidecar = writeSidecar(repo, {
      slug: 'feat-x',
      title: 'feat/x → main',
      mode: 'branch',
      base,
      head,
      changeSets: [{ id: 'feat-x', kind: 'branch', base, head }],
      curation: {
        sets: {
          'feat-x': {
            summary: 'Adds a session ttl.',
            files: {
              'src/auth/session.ts': { tier: 'core', note: 'The new setting.' },
              'src/keep.ts': { tier: 'core', note: 'Read second.' },
              'src/not-in-diff.ts': { tier: 'supporting' },
            },
            findings: [
              { severity: 'high', verdict: 'CONFIRMED', file: 'src/auth/session.ts', line: 1, text: 'ttl is seconds, callers pass ms.' },
              { file: 'src/old-name.ts', text: 'Renamed file referenced by its old path.' },
              { text: 'No file.' },
            ],
          },
        },
      },
    });

    const { out, html, report } = build(sidecar, { now: new Date('2026-10-02T12:00:00Z') });
    assert.equal(out, join(repo.dir, 'reviews', 'feat-x.html'));
    assert.equal(readFileSync(out, 'utf8'), html);
    const data = pageData(html);
    assert.equal(data.meta.generatedAt, '2026-10-02T12:00:00.000Z');
    assert.equal(data.meta.baseSha, base.slice(0, data.meta.baseSha.length));
    const [set] = data.sets;

    assert.deepEqual(set.files.map((file) => file.path).sort(), [
      'assets/logo.png',
      'pnpm-lock.yaml',
      'src/auth/session.test.ts',
      'src/auth/session.ts',
      'src/gone.ts',
      'src/keep.ts',
      'src/new name é.ts',
    ]);

    const renamed = fileOf(set, 'src/new name é.ts');
    assert.equal(renamed.status, 'R');
    assert.equal(renamed.oldPath, 'src/old-name.ts');
    assert.match(renamed.patch, /rename from src\/old-name\.ts/);

    assert.deepEqual(fileOf(set, 'src/keep.ts'), {
      ...fileOf(set, 'src/keep.ts'),
      status: 'M',
      adds: 1,
      dels: 1,
      tier: 'core',
      note: 'Read second.',
    });
    assert.match(fileOf(set, 'src/keep.ts').patch, /^-line 3$\n^\+line three$/m);
    assert.deepEqual(fileOf(set, 'src/gone.ts').flags, ['deleted']);
    assert.deepEqual(fileOf(set, 'src/auth/session.ts').flags, ['auth']);
    assert.equal(fileOf(set, 'src/auth/session.test.ts').tier, 'tests');
    assert.equal(fileOf(set, 'assets/logo.png').binary, true);

    const lock = fileOf(set, 'pnpm-lock.yaml');
    assert.equal(lock.tier, 'generated');
    assert.equal(lock.omitted, true);
    assert.equal(lock.patch, '');
    assert.equal(report.omitted.length, 1);

    assert.deepEqual(
      set.startHere.map((index) => set.files[index].path),
      ['src/auth/session.ts', 'src/keep.ts'],
    );
    assert.deepEqual(
      set.findings.map(({ id, severity, verdict, fileIndex }) => ({ id, severity, verdict, path: set.files[fileIndex]?.path ?? null })),
      [
        { id: 'feat-x-F1', severity: 'high', verdict: 'CONFIRMED', path: 'src/auth/session.ts' },
        { id: 'feat-x-F2', severity: 'medium', verdict: null, path: 'src/new name é.ts' },
        { id: 'feat-x-F3', severity: 'medium', verdict: null, path: null },
      ],
    );
    assert.deepEqual(report.missing, ['feat-x src/not-in-diff.ts']);
    assert.deepEqual(report.failures, []);
  });

  test('a rebuild with an unchanged sidecar produces the same page', (t) => {
    const { repo, base, head } = branchRepo(t);
    const sidecar = writeSidecar(repo, { slug: 's', changeSets: [{ id: 's', base, head }] });
    const now = new Date('2026-10-02T12:00:00Z');
    assert.equal(build(sidecar, { now }).html, build(sidecar, { now }).html);
  });

  test('the page carries usage numbers but not the local transcript path', (t) => {
    const { repo, base, head } = branchRepo(t);
    const transcript = '/home/someone/.claude/projects/-repo/session.jsonl';
    const usage = { wallMs: 60000, phases: [], total: { input: 1, cacheRead: 0, cacheCreate: 0, output: 1, messages: 1 }, agents: 0, transcript };
    const sidecar = writeSidecar(repo, { slug: 's', changeSets: [{ id: 's', base, head }], usage });
    const { html } = build(sidecar);
    assert.equal(pageData(html).usage.wallMs, 60000);
    assert.ok(!html.includes(transcript));
  });
});

describe('build: worktree', () => {
  test('staged, unstaged and untracked work is one set; an empty worktree set is dropped', (t) => {
    const repo = makeRepo(t);
    repo.write('a.txt', 'one\n');
    repo.write('.gitignore', 'ignored.log\n');
    repo.commit('base');
    const sidecar = writeSidecar(repo, { slug: 'wt', changeSets: [{ id: 'worktree', kind: 'worktree' }] });
    assert.equal(pageData(build(sidecar).html).sets.length, 0);

    repo.write('a.txt', 'one\ntwo\n');
    repo.write('staged.txt', 'staged\n');
    repo.git('add', 'staged.txt');
    repo.write('new dir/untracked.md', '++ starts with two plus signs\n+++ and three\nplain\n');
    repo.write('ignored.log', 'noise\n');
    const [set] = pageData(build(sidecar).html).sets;
    assert.deepEqual(set.files.map((file) => [file.path, file.status, file.adds, file.dels]).sort(), [
      ['a.txt', 'M', 1, 0],
      ['new dir/untracked.md', 'A', 3, 0],
      ['staged.txt', 'A', 1, 0],
    ]);
    assert.match(fileOf(set, 'new dir/untracked.md').patch, /^\+\+\+ starts with two plus signs$/m);
  });
});

describe('build: train', () => {
  test('one set per merge with only its own delta, then the fix commits', (t) => {
    const repo = makeRepo(t);
    repo.write('app.ts', 'export const app = 1;\n');
    const base = repo.commit('base');
    repo.git('checkout', '--quiet', '-b', 'feat/a');
    repo.write('a.ts', 'export const a = 1;\n');
    repo.commit('feat: a');
    repo.git('checkout', '--quiet', '-b', 'feat/b');
    repo.write('b.ts', 'export const b = 1;\n');
    repo.commit('feat: b (stacked on a)');
    repo.git('checkout', '--quiet', '-b', 'chore/merge-train', base);
    repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #1 feat/a into merge train', 'feat/a');
    repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #2 feat/b into merge train', 'feat/b');
    repo.write('a.ts', 'export const a = 2;\n');
    const fix = repo.commit('fix: a off by one (1-F1)');

    const sidecar = writeSidecar(repo, {
      slug: 'train',
      mode: 'train',
      depth: 'full',
      train: { base, head: 'chore/merge-train' },
      curation: { sets: { 1: { title: 'Add a', findings: [{ severity: 'low', text: 'a is 1.' }] } } },
    });
    const data = pageData(build(sidecar).html);
    assert.deepEqual(
      data.sets.map((set) => [set.id, set.kind, set.title, set.files.map((file) => file.path)]),
      [
        ['1', 'merge', 'Add a', ['a.ts']],
        ['2', 'merge', '#2 feat/b', ['b.ts']],
        [fix.slice(0, 7), 'fixes', 'fix: a off by one (1-F1)', ['a.ts']],
      ],
    );
    assert.equal(data.sets[0].findings[0].id, '1-F1');
    assert.equal(data.meta.head, 'chore/merge-train');
  });
});

describe('build: errors', () => {
  const cli = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'build.mjs'), ...args], { encoding: 'utf8' });

  test('an invalid sidecar lists its problems and writes no page', (t) => {
    const repo = makeRepo(t);
    repo.commit('base');
    const sidecar = writeSidecar(repo, { slug: 'bad', changeSets: [{ id: 'x', kind: 'pr' }] });
    const result = cli(sidecar);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not a valid sidecar:\n {2}- changeSets\[0\] needs base and head/);
    assert.doesNotMatch(result.stderr, /at .*\.mjs:\d+/);
  });

  test('an unknown ref is named, not dumped as a git stack trace', (t) => {
    const repo = makeRepo(t);
    const head = repo.commit('base');
    const sidecar = writeSidecar(repo, { slug: 'ref', changeSets: [{ id: 'x', base: 'origin/nope', head }] });
    const result = cli(sidecar);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'review-board: change set "x": base "origin/nope" is not a commit in this repo');
  });

  test('a missing skeleton or sidecar is explained', (t) => {
    const repo = makeRepo(t);
    const head = repo.commit('base');
    const sidecar = writeSidecar(repo, { slug: 'nosk', changeSets: [{ id: 'x', base: head, head }] });
    execFileSync('rm', [join(repo.dir, 'reviews', 'skeleton.html')]);
    assert.match(cli(sidecar).stderr, /skeleton missing: .*run init\.mjs first/);
    assert.match(cli(join(repo.dir, 'nope.review.json')).stderr, /sidecar not found/);
    const noArgs = cli();
    assert.equal(noArgs.status, 1);
    assert.match(noArgs.stdout, /^usage: node build\.mjs/);
  });

  test('the CLI prints the build report on success', (t) => {
    const { repo, base, head } = branchRepo(t);
    const sidecar = writeSidecar(repo, { slug: 'ok', changeSets: [{ id: 'ok', label: 'feat/x', base, head }] });
    writeFileSync(join(repo.dir, 'reviews', 'stale.html'), '');
    const result = cli(sidecar);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /ok\.html \d+\.\d\d MB\nfeat\/x: 7 files \+\d+ -\d+, 0 findings\ndiff failures: none\ncurated paths not in change set: none\npatches omitted/,
    );
  });
});
