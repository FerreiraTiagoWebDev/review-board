import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { loadSidecar, SidecarError, validateSidecar, writeJson } from '../../skills/review-board/scripts/lib/sidecar.mjs';
import { tempDir } from '../helpers/repo.mjs';

/** @returns {any} */
const valid = () => ({
  slug: 'pr-1',
  mode: 'pr',
  depth: 'full',
  changeSets: [
    { id: '1', kind: 'pr', base: 'aaa', head: 'bbb' },
    { id: 'worktree', kind: 'worktree' },
  ],
  curation: {
    sets: {
      1: {
        files: { 'src/a.ts': { tier: 'core', note: 'Start here.' } },
        findings: [{ severity: 'high', verdict: 'CONFIRMED', file: 'src/a.ts', line: 3, text: 'Off by one.' }],
      },
    },
    tierRules: { tests: '^e2e/' },
    verification: { lead: 'On bbb.', rows: [{ check: 'pnpm test', result: 'pass' }] },
    decisions: [{ id: 'D1', title: 'Push?', options: ['Yes', 'No'] }],
  },
});

describe('validateSidecar', () => {
  test('accepts a complete sidecar and a minimal train', () => {
    assert.deepEqual(validateSidecar(valid()), []);
    assert.deepEqual(validateSidecar({ train: { base: 'origin/main', head: 'chore/train' } }), []);
  });

  test('reports every problem at once, with a path to each', () => {
    const review = valid();
    review.mode = 'weird';
    review.changeSets.push({ id: '1', kind: 'pr', base: 'x' });
    review.changeSets.push({ id: 'a"b', kind: 'pr', base: 'x', head: 'y' });
    review.curation.sets[1].files['src/a.ts'] = { tier: 'core' };
    review.curation.sets[1].findings.push({ id: '1-F1', severity: 'critical', verdict: 'maybe', line: 0, text: '' });
    review.curation.tierRules.generated = '(';
    review.curation.verification.rows.push({ check: 'x' });
    review.curation.decisions.push({ id: 'D2', title: 'One option', options: ['Only'] });
    const problems = validateSidecar(review);
    const expected = [
      /^mode must be one of/,
      /^changeSets\[2\] needs base and head/,
      /^changeSets\[3\]\.id must be letters, digits/,
      /^change set id "1" is used twice$/,
      /^curation\.tierRules\.generated is not a valid regex/,
      /^curation\.sets\.1\.files\["src\/a\.ts"\] is core and needs a note$/,
      /^curation\.sets\.1\.findings\[1\]\.text is required$/,
      /^curation\.sets\.1\.findings\[1\]\.severity must be one of low, medium, high$/,
      /^curation\.sets\.1\.findings\[1\]\.verdict must be one of CONFIRMED, PLAUSIBLE$/,
      /^curation\.sets\.1\.findings\[1\]\.line must be a positive integer$/,
      /^finding id "1-F1" is used by curation\.sets\.1\.findings\[0\] and curation\.sets\.1\.findings\[1\]$/,
      /^curation\.verification\.rows\[1\] needs check and result$/,
      /^curation\.decisions\[1\]\.options needs at least two strings$/,
    ];
    for (const pattern of expected)
      assert.ok(
        problems.some((problem) => pattern.test(problem)),
        `missing ${pattern}\n${problems.join('\n')}`,
      );
    assert.equal(problems.length, expected.length, problems.join('\n'));
  });

  test('rejects a sidecar with nothing to review', () => {
    assert.deepEqual(validateSidecar({ changeSets: [] }), ['nothing to review: no train and no changeSets']);
    assert.deepEqual(validateSidecar([]), ['top level must be an object']);
  });
});

describe('loadSidecar', () => {
  test('throws a SidecarError naming the file for invalid JSON and invalid content', (t) => {
    const dir = tempDir(t);
    const broken = join(dir, 'broken.review.json');
    writeFileSync(broken, '{ nope');
    assert.throws(
      () => loadSidecar(broken),
      (error) => error instanceof SidecarError && error.message.startsWith(`${broken} is not a valid sidecar`),
    );
    const empty = join(dir, 'empty.review.json');
    writeFileSync(empty, '{}');
    assert.throws(() => loadSidecar(empty), /nothing to review/);
  });
});

describe('writeJson', () => {
  test('writes pretty JSON with a trailing newline and leaves no temp file', (t) => {
    const dir = tempDir(t);
    const path = join(dir, 'x.json');
    writeJson(path, { a: 1 });
    assert.equal(readFileSync(path, 'utf8'), '{\n  "a": 1\n}\n');
    assert.deepEqual(readdirSync(dir), ['x.json']);
  });
});
