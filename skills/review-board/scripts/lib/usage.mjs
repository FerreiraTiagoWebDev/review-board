import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const PHASES = ['scope', 'train', 'review', 'verify', 'curate', 'build', 'loop', 'act'];

/**
 * Closes the open phase and, unless `phase` is "end", opens a new one.
 * @param {{ phases?: { name: string, startedAt: string, endedAt?: string }[] }} review
 * @param {string} phase
 * @param {Date} now
 */
export function markPhase(review, phase, now = new Date()) {
  if (phase !== 'end' && !PHASES.includes(phase)) throw new Error(`unknown phase "${phase}", expected one of ${[...PHASES, 'end'].join(', ')}`);
  const at = now.toISOString();
  review.phases ??= [];
  const open = review.phases.find((entry) => !entry.endedAt);
  if (open) open.endedAt = at;
  if (phase !== 'end') review.phases.push({ name: phase, startedAt: at });
  return (open ? `closed ${open.name}` : 'no open phase') + (phase !== 'end' ? `, started ${phase}` : '');
}

/** Claude Code stores a session under ~/.claude/projects/<cwd with every non-alphanumeric replaced by "-">. */
export const projectDir = (repo, home) => join(home, '.claude', 'projects', resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'));

/** @param {{ review: { transcript?: string, sessionId?: string }, repo: string, home: string, transcript?: string, session?: string }} input */
export function resolveTranscript({ review, repo, home, transcript, session }) {
  const explicit = transcript ?? review.transcript;
  if (explicit) return resolve(explicit.replace(/^~(?=\/|$)/, home));
  const id = session ?? review.sessionId;
  if (!id) throw new Error('need --transcript <path> or --session <id> (or "transcript" / "sessionId" in the sidecar)');
  return join(projectDir(repo, home), `${id}.jsonl`);
}

export function subagentTranscripts(transcript) {
  const dir = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents');
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .sort()
        .map((name) => join(dir, name))
    : [];
}

/**
 * One entry per API response. Claude Code writes a transcript line per content block,
 * each repeating the response's usage, so lines are deduplicated by message id.
 * @param {string} text JSONL transcript
 */
export function parseUsage(text) {
  const byId = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (entry?.type !== 'assistant' || !usage || !entry.timestamp) continue;
    const id = entry.message.id ?? entry.requestId ?? entry.uuid;
    if (!byId.has(id)) byId.set(id, { at: Date.parse(entry.timestamp), usage });
  }
  return [...byId.values()];
}

const emptyBucket = () => ({ input: 0, cacheRead: 0, cacheCreate: 0, output: 0, messages: 0 });

function add(bucket, usage) {
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  bucket.input += (usage.input_tokens ?? 0) + cacheRead + cacheCreate;
  bucket.cacheRead += cacheRead;
  bucket.cacheCreate += cacheCreate;
  bucket.output += usage.output_tokens ?? 0;
  bucket.messages += 1;
}

/**
 * @param {{ phases?: { name: string, startedAt: string, endedAt?: string }[] }} review
 * @param {{ file: string, text: string, subagent: boolean }[]} transcripts
 * @param {Date} now
 */
export function summarizeUsage(review, transcripts, now = new Date()) {
  const nowMs = now.getTime();
  const phases = (review.phases ?? []).map((phase) => ({
    name: phase.name,
    start: Date.parse(phase.startedAt),
    end: phase.endedAt ? Date.parse(phase.endedAt) : nowMs,
    bucket: emptyBucket(),
  }));
  const total = emptyBucket();
  const agentsSeen = new Set();
  const windowStart = phases.length ? Math.min(...phases.map((phase) => phase.start)) : 0;
  const windowEnd = phases.length ? Math.max(...phases.map((phase) => phase.end)) : nowMs;
  for (const { file, text, subagent } of transcripts) {
    for (const message of parseUsage(text)) {
      if (message.at < windowStart || message.at > windowEnd) continue;
      add(total, message.usage);
      if (subagent) agentsSeen.add(file);
      const phase = phases.find((entry) => message.at >= entry.start && message.at < entry.end) ?? phases.findLast((entry) => message.at === entry.end);
      if (phase) add(phase.bucket, message.usage);
    }
  }
  return {
    generatedAt: now.toISOString(),
    wallMs: windowEnd - windowStart,
    phases: phases.map((phase) => ({ name: phase.name, ms: phase.end - phase.start, ...phase.bucket })),
    total,
    agents: agentsSeen.size,
  };
}

export function readTranscripts(transcript) {
  if (!existsSync(transcript)) throw new Error(`transcript not found: ${transcript}`);
  return [transcript, ...subagentTranscripts(transcript)].map((file) => ({ file, text: readFileSync(file, 'utf8'), subagent: file !== transcript }));
}

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const fmtMinutes = (ms) => `${Math.round(ms / 60000)}m`;

export function formatUsage(usage) {
  const { total } = usage;
  const phases = usage.phases.map((phase) => `${phase.name} ${fmtMinutes(phase.ms)}/${fmtTokens(phase.input + phase.output)}`).join(', ');
  return `review-board: ${fmtMinutes(usage.wallMs)} wall · in ${fmtTokens(total.input)} (${fmtTokens(total.cacheRead)} cached) · out ${fmtTokens(total.output)} · ${usage.agents} subagents · ${phases}`;
}
