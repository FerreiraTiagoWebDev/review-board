import { spawnSync } from 'node:child_process';

// The plugin has no "version" on purpose: Claude Code then versions it by commit, so every push is an update.
const ALLOWED = [/(^|→ )version$/];
const [command, ...prefix] = (process.env.CLAUDE_BIN ?? 'claude').split(' ');
let failed = false;

for (const target of ['.', '.claude-plugin/plugin.json']) {
  const result = spawnSync(command, [...prefix, 'plugin', 'validate', target, '--strict', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error(`${target}: unreadable validator output (exit ${result.status})\n${result.stdout}${result.stderr}`);
    process.exit(1);
  }
  const reports = [report.manifest, ...(report.contents ?? [])].filter(Boolean);
  const problems = reports.flatMap((entry) => [...entry.errors, ...entry.warnings.filter((warning) => !ALLOWED.some((rule) => rule.test(warning.path)))]);
  for (const problem of problems) console.error(`${target}: ${problem.path}: ${problem.message}`);
  failed ||= problems.length > 0;
  console.log(`${target}: ${problems.length ? 'invalid' : 'valid'}`);
}
process.exitCode = failed ? 1 : 0;
