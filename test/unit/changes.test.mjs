import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { groupTrain, MERGE_SUBJECT, parseCommits, parseNameStatus, parseNumstat } from '../../skills/review-board/scripts/lib/changes.mjs';
import { splitNul } from '../../skills/review-board/scripts/lib/git.mjs';

describe('splitNul', () => {
  test('drops only the trailing terminator', () => {
    assert.deepEqual(splitNul('a\0b\0'), ['a', 'b']);
    assert.deepEqual(splitNul(''), []);
  });
});

describe('parseNameStatus', () => {
  test('reads modify, add, delete and rename records', () => {
    const text = 'M\0src/a.ts\0A\0new file.ts\0D\0gone.ts\0R087\0old/x.ts\0new/x.ts\0';
    assert.deepEqual(parseNameStatus(text), [
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'new file.ts' },
      { status: 'D', path: 'gone.ts' },
      { status: 'R', oldPath: 'old/x.ts', path: 'new/x.ts' },
    ]);
  });

  test('keeps paths with tabs, quotes and unicode intact', () => {
    assert.deepEqual(parseNameStatus('M\0dir/tab\there "q" é.ts\0'), [{ status: 'M', path: 'dir/tab\there "q" é.ts' }]);
  });

  test('treats a copy as an added file at the new path', () => {
    assert.deepEqual(parseNameStatus('C100\0a.ts\0b.ts\0'), [{ status: 'A', path: 'b.ts' }]);
  });
});

describe('parseNumstat', () => {
  test('reads plain, rename and binary records', () => {
    const stats = parseNumstat('3\t1\tsrc/a.ts\0' + '5\t2\t\0old/x.ts\0new/x.ts\0' + '-\t-\tlogo.png\0');
    assert.deepEqual(stats.get('src/a.ts'), { adds: 3, dels: 1, binary: false });
    assert.deepEqual(stats.get('new/x.ts'), { adds: 5, dels: 2, binary: false });
    assert.deepEqual(stats.get('logo.png'), { adds: 0, dels: 0, binary: true });
    assert.equal(stats.has('old/x.ts'), false);
  });
});

describe('parseCommits', () => {
  test('reads sha, parents and a subject containing spaces', () => {
    const text = 'commit aaa\naaa\0p1 p2\0merge: #12 feat/x into merge train\ncommit bbb\nbbb\0aaa\0fix: a thing\n';
    assert.deepEqual(parseCommits(text), [
      { sha: 'aaa', parents: ['p1', 'p2'], subject: 'merge: #12 feat/x into merge train' },
      { sha: 'bbb', parents: ['aaa'], subject: 'fix: a thing' },
    ]);
  });
});

describe('MERGE_SUBJECT', () => {
  test('parses the train merge subject in both spellings', () => {
    assert.deepEqual(MERGE_SUBJECT.exec('merge: #1249 feat/x into merge train')?.slice(1), ['1249', 'feat/x']);
    assert.deepEqual(MERGE_SUBJECT.exec('merge: #7 fix/y into train')?.slice(1), ['7', 'fix/y']);
    assert.equal(MERGE_SUBJECT.exec('Merge branch feat/x'), null);
  });
});

describe('groupTrain', () => {
  const sha = (n) => String(n).repeat(40);
  const mergeBase = (a, b) => `base(${a.slice(0, 1)},${b.slice(0, 1)})`;

  test('one set per merge, consecutive plain commits grouped as fixes', () => {
    const commits = [
      { sha: sha(1), parents: [sha(0), sha(5)], subject: 'merge: #10 feat/a into merge train' },
      { sha: sha(2), parents: [sha(1)], subject: 'fix: one (10-F1)' },
      { sha: sha(3), parents: [sha(2)], subject: 'fix: two (10-F2)' },
      { sha: sha(4), parents: [sha(3), sha(6)], subject: 'merge: #11 feat/b into merge train' },
      { sha: sha(7), parents: [sha(4)], subject: 'fix: three' },
    ];
    const sets = groupTrain(commits, mergeBase);
    assert.deepEqual(
      sets.map(({ id, kind, label, base, head }) => ({ id, kind, label, base, head })),
      [
        { id: '10', kind: 'merge', label: '#10 feat/a', base: 'base(0,5)', head: sha(5) },
        { id: `fixes-${sha(2).slice(0, 7)}`, kind: 'fixes', label: 'Fixes (2 commits)', base: sha(1), head: sha(3) },
        { id: '11', kind: 'merge', label: '#11 feat/b', base: 'base(3,6)', head: sha(6) },
        { id: sha(7).slice(0, 7), kind: 'fixes', label: 'fix: three', base: sha(4), head: sha(7) },
      ],
    );
    assert.equal(sets[0].pr, 10);
    assert.deepEqual(sets[1].commits, [
      { sha: sha(2).slice(0, 7), subject: 'fix: one (10-F1)' },
      { sha: sha(3).slice(0, 7), subject: 'fix: two (10-F2)' },
    ]);
  });

  test('a merge with a foreign subject is keyed by its short sha', () => {
    const [set] = groupTrain([{ sha: sha(1), parents: [sha(0), sha(2)], subject: 'Merge pull request #3' }], mergeBase);
    assert.equal(set.id, sha(1).slice(0, 7));
    assert.equal(set.label, 'Merge pull request #3');
    assert.equal(set.pr, undefined);
  });
});
