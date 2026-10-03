import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isMain, run } from './lib/cli.mjs';
import { readJson, writeJson } from './lib/sidecar.mjs';
import { formatUsage, markPhase, readTranscripts, resolveTranscript, summarizeUsage } from './lib/usage.mjs';

const HELP = `usage:
  node usage.mjs mark <reviews/<slug>.review.json> <phase>   close the open phase, start <phase>
  node usage.mjs mark <reviews/<slug>.review.json> end       close the open phase
  node usage.mjs report <reviews/<slug>.review.json> [--transcript <path>] [--session <id>]
        sum tokens per phase from the session transcript and its subagents, store under "usage" in the sidecar`;

const flag = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

/** @param {string[]} argv @param {{ now?: Date, home?: string }} [options] */
export function usage(argv, { now = new Date(), home = homedir() } = {}) {
  const [command, sidecarArg, ...rest] = argv;
  if (command === '--help' || command === 'help') return { output: HELP, code: 0 };
  if (!['mark', 'report'].includes(command) || !sidecarArg) return { output: HELP, code: 1 };
  const sidecarPath = resolve(sidecarArg);
  const review = readJson(sidecarPath);
  if (command === 'mark') {
    if (!rest[0]) return { output: HELP, code: 1 };
    const message = markPhase(review, rest[0], now);
    writeJson(sidecarPath, review);
    return { output: message, code: 0 };
  }
  const transcript = resolveTranscript({
    review,
    repo: review.repo ?? join(dirname(sidecarPath), '..'),
    home,
    transcript: flag(rest, '--transcript'),
    session: flag(rest, '--session'),
  });
  review.usage = { ...summarizeUsage(review, readTranscripts(transcript), now), transcript };
  writeJson(sidecarPath, review);
  return { output: formatUsage(review.usage), code: 0 };
}

if (isMain(import.meta.url)) {
  run(() => {
    const { output, code } = usage(process.argv.slice(2));
    (code ? console.error : console.log)(output);
    process.exitCode = code;
  });
}
