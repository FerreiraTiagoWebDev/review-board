import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { formatUsage, markPhase, parseUsage, projectDir, resolveTranscript, summarizeUsage } from '../../skills/review-board/scripts/lib/usage.mjs';

const at = (minute) => new Date(Date.UTC(2026, 9, 2, 10, minute));
const line = (id, minute, usage, type = 'assistant') => JSON.stringify({ type, timestamp: at(minute).toISOString(), message: { id, usage } });

describe('markPhase', () => {
  test('closes the open phase, opens the next, and "end" only closes', () => {
    const review = {};
    assert.equal(markPhase(review, 'scope', at(0)), 'no open phase, started scope');
    assert.equal(markPhase(review, 'build', at(5)), 'closed scope, started build');
    assert.equal(markPhase(review, 'end', at(9)), 'closed build');
    assert.deepEqual(review, {
      phases: [
        { name: 'scope', startedAt: at(0).toISOString(), endedAt: at(5).toISOString() },
        { name: 'build', startedAt: at(5).toISOString(), endedAt: at(9).toISOString() },
      ],
    });
  });

  test('rejects an unknown phase without touching the sidecar', () => {
    const review = { phases: [] };
    assert.throws(() => markPhase(review, 'buidl', at(0)), /unknown phase "buidl"/);
    assert.deepEqual(review, { phases: [] });
  });
});

describe('parseUsage', () => {
  test('counts each API response once although the transcript repeats it per content block', () => {
    const usage = { input_tokens: 10, output_tokens: 5 };
    const text = [line('msg_1', 1, usage), line('msg_1', 1, usage), line('msg_1', 1, usage), line('msg_2', 2, usage), '', 'not json'].join('\n');
    assert.equal(parseUsage(text).length, 2);
  });

  test('ignores user entries and entries without usage or timestamp', () => {
    const text = [line('u', 1, { input_tokens: 1 }, 'user'), JSON.stringify({ type: 'assistant', message: { id: 'x', usage: {} } })].join('\n');
    assert.deepEqual(parseUsage(text), []);
  });
});

describe('summarizeUsage', () => {
  const review = {
    phases: [
      { name: 'scope', startedAt: at(0).toISOString(), endedAt: at(10).toISOString() },
      { name: 'build', startedAt: at(10).toISOString(), endedAt: at(20).toISOString() },
    ],
  };
  const usage = { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 20 };

  test('buckets by phase, counts each boundary message once, skips messages outside the window', () => {
    const main = [line('a', 5, usage), line('b', 10, usage), line('c', 20, usage), line('late', 30, usage), line('early', -5, usage)].join('\n');
    const agent = line('d', 15, usage);
    const result = summarizeUsage(
      review,
      [
        { file: 'main.jsonl', text: main, subagent: false },
        { file: 'agent-1.jsonl', text: agent, subagent: true },
      ],
      at(40),
    );
    assert.equal(result.wallMs, 20 * 60_000);
    assert.equal(result.agents, 1);
    assert.deepEqual(
      result.phases.map(({ name, messages }) => ({ name, messages })),
      [
        { name: 'scope', messages: 1 },
        { name: 'build', messages: 3 },
      ],
    );
    assert.deepEqual(result.total, { input: 4 * 1050, cacheRead: 4 * 900, cacheCreate: 4 * 50, output: 4 * 20, messages: 4 });
    assert.match(formatUsage(result), /^review-board: 20m wall · in 4k \(4k cached\) · out 80 · 1 subagents · scope 10m\/1k, build 10m\/3k$/);
  });

  test('an open phase runs until now', () => {
    const result = summarizeUsage({ phases: [{ name: 'loop', startedAt: at(0).toISOString() }] }, [], at(7));
    assert.equal(result.phases[0].ms, 7 * 60_000);
  });
});

describe('transcript location', () => {
  test('encodes the project path the way Claude Code does', () => {
    assert.equal(projectDir('/Users/me/my_app.v2', '/h'), join('/h', '.claude', 'projects', '-Users-me-my-app-v2'));
  });

  test('explicit transcript wins, ~ expands, session id falls back to the project dir', () => {
    const review = { sessionId: 's1', transcript: '~/t.jsonl' };
    assert.equal(resolveTranscript({ review, repo: '/r', home: '/h' }), '/h/t.jsonl');
    assert.equal(resolveTranscript({ review: { sessionId: 's1' }, repo: '/r', home: '/h' }), '/h/.claude/projects/-r/s1.jsonl');
    assert.equal(resolveTranscript({ review: {}, repo: '/r', home: '/h', session: 's2' }), '/h/.claude/projects/-r/s2.jsonl');
    assert.throws(() => resolveTranscript({ review: {}, repo: '/r', home: '/h' }), /need --transcript/);
  });
});
