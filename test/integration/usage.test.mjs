import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { usage } from '../../skills/review-board/scripts/usage.mjs';
import { SCRIPTS, tempDir } from '../helpers/repo.mjs';

const entry = (id, iso, output) => JSON.stringify({ type: 'assistant', timestamp: iso, message: { id, usage: { input_tokens: 1000, output_tokens: output } } });

describe('usage', () => {
  test('mark → report reads the session and its subagents from the project dir and stores the result', (t) => {
    const home = tempDir(t);
    const repo = tempDir(t);
    mkdirSync(join(repo, 'reviews'));
    const sidecar = join(repo, 'reviews', 'x.review.json');
    writeFileSync(sidecar, JSON.stringify({ sessionId: 'sess', repo }));

    usage(['mark', sidecar, 'scope'], { now: new Date('2026-10-02T10:00:00Z') });
    usage(['mark', sidecar, 'build'], { now: new Date('2026-10-02T10:10:00Z') });
    usage(['mark', sidecar, 'end'], { now: new Date('2026-10-02T10:30:00Z') });

    const dir = join(home, '.claude', 'projects', repo.replace(/[^a-zA-Z0-9]/g, '-'));
    mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'sess.jsonl'), [entry('m1', '2026-10-02T10:05:00Z', 500), entry('m1', '2026-10-02T10:05:00Z', 500)].join('\n'));
    writeFileSync(join(dir, 'sess', 'subagents', 'agent-a.jsonl'), entry('m2', '2026-10-02T10:20:00Z', 1500));

    const result = usage(['report', sidecar], { now: new Date('2026-10-02T11:00:00Z'), home });
    assert.deepEqual(result, { code: 0, output: 'review-board: 30m wall · in 2k (0 cached) · out 2k · 1 subagents · scope 10m/2k, build 20m/3k' });
    const stored = JSON.parse(readFileSync(sidecar, 'utf8')).usage;
    assert.equal(stored.transcript, join(dir, 'sess.jsonl'));
    assert.equal(stored.total.messages, 2);
  });

  test('CLI: help, bad phase, missing transcript', (t) => {
    const dir = tempDir(t);
    const sidecar = join(dir, 'x.review.json');
    writeFileSync(sidecar, JSON.stringify({ transcript: join(dir, 'missing.jsonl') }));
    const cli = (...args) => spawnSync(process.execPath, [join(SCRIPTS, 'usage.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(cli('--help').status, 0);
    assert.equal(cli().status, 1);
    const badPhase = cli('mark', sidecar, 'nope');
    assert.equal(badPhase.status, 1);
    assert.match(badPhase.stderr, /^review-board: unknown phase "nope"/);
    const missing = cli('report', sidecar);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /transcript not found/);
  });
});
