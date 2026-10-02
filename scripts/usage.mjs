import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

const [command, sidecarArg, ...rest] = process.argv.slice(2);

function help() {
  console.log(`usage:
  node usage.mjs mark <reviews/<slug>.review.json> <phase>   close the open phase, start <phase>
  node usage.mjs mark <reviews/<slug>.review.json> end       close the open phase
  node usage.mjs report <reviews/<slug>.review.json> [--transcript <path>] [--session <id>]
        sum tokens per phase from the session transcript and its subagents, store under "usage" in the sidecar`);
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const flag = (name) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};

function mark(review, phase) {
  const now = new Date().toISOString();
  review.phases ??= [];
  const open = review.phases.find((entry) => !entry.endedAt);
  if (open) open.endedAt = now;
  if (phase && phase !== 'end') review.phases.push({ name: phase, startedAt: now });
  writeJson(sidecarPath, review);
  console.log((open ? `closed ${open.name}` : 'no open phase') + (phase && phase !== 'end' ? `, started ${phase}` : ''));
}

function projectDir(repo) {
  const encoded = resolve(repo).replace(/[/.]/g, '-');
  return join(homedir(), '.claude', 'projects', encoded);
}

function resolveTranscript(review) {
  const explicit = flag('--transcript') ?? review.transcript;
  if (explicit) return resolve(explicit.replace(/^~/, homedir()));
  const session = flag('--session') ?? review.sessionId;
  if (!session) throw new Error('need --transcript <path> or --session <id> (or "transcript" / "sessionId" in the sidecar)');
  return join(projectDir(review.repo ?? join(dirname(sidecarPath), '..')), `${session}.jsonl`);
}

function* messages(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry?.message?.usage;
    if (entry.type === 'assistant' && usage && entry.timestamp) yield { at: Date.parse(entry.timestamp), usage };
  }
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

function report(review) {
  const transcript = resolveTranscript(review);
  const agentsDir = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents');
  const agentFiles = existsSync(agentsDir) ? readdirSync(agentsDir).filter((name) => name.endsWith('.jsonl')).map((name) => join(agentsDir, name)) : [];
  const now = Date.now();
  const phases = (review.phases ?? []).map((phase) => ({
    name: phase.name,
    start: Date.parse(phase.startedAt),
    end: phase.endedAt ? Date.parse(phase.endedAt) : now,
    bucket: emptyBucket(),
  }));
  const total = emptyBucket();
  const agentsSeen = new Set();
  const windowStart = phases.length ? Math.min(...phases.map((phase) => phase.start)) : 0;
  const windowEnd = phases.length ? Math.max(...phases.map((phase) => phase.end)) : now;
  for (const file of [transcript, ...agentFiles]) {
    for (const message of messages(file)) {
      if (message.at < windowStart || message.at > windowEnd) continue;
      add(total, message.usage);
      if (file !== transcript) agentsSeen.add(file);
      const phase = phases.find((entry) => message.at >= entry.start && message.at <= entry.end);
      if (phase) add(phase.bucket, message.usage);
    }
  }
  review.usage = {
    generatedAt: new Date(now).toISOString(),
    transcript,
    wallMs: windowEnd - windowStart,
    phases: phases.map((phase) => ({ name: phase.name, ms: phase.end - phase.start, ...phase.bucket })),
    total,
    agents: agentsSeen.size,
  };
  writeJson(sidecarPath, review);
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  const minutes = (ms) => Math.round(ms / 60000) + 'm';
  console.log(
    `review-board: ${minutes(review.usage.wallMs)} wall · in ${fmt(total.input)} (${fmt(total.cacheRead)} cached) · out ${fmt(total.output)} · ${review.usage.agents} subagents · ` +
      review.usage.phases.map((phase) => `${phase.name} ${minutes(phase.ms)}/${fmt(phase.input + phase.output)}`).join(', '),
  );
}

if (!command || !sidecarArg || command === '--help') {
  help();
  process.exit(command ? 0 : 1);
}
const sidecarPath = resolve(sidecarArg);
const review = readJson(sidecarPath);
if (command === 'mark') mark(review, rest[0]);
else if (command === 'report') report(review);
else {
  help();
  process.exit(1);
}
