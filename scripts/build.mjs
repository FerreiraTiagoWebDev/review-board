import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const MERGE_SUBJECT = /^merge: #(\d+) (\S+) into (?:merge )?train$/;
const OMIT_PATCH_BYTES = 100_000;
const LARGE_CHURN = 300;
const DEFAULT_TIER_RULES = {
  tests: /\.spec\.|\.test\.|\.integration-spec\.|\/test\/|\/tests\/|\/__tests__\//,
  generated: /(\.gen\.ts|\.snap|\.generated\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|\.lock)$/,
};
const FLAG_RULES = [
  ['schema', /(^|\/)prisma\/|(^|\/)migrations\//i],
  ['auth', /auth|security|crypto|cipher|token|secret|password|hmac|signed|permission|guard|roles?\b/i],
  ['api', /controller|(^|\/)routes?\/|(^|\/)api\/|route\.(ts|tsx|js)$|webhook|resolver|gateway/i],
  ['config', /(^|\/)\.env|(^|\/)env\/|\.ya?ml$|Dockerfile|(^|\/)\.github\/|\.config\.(ts|js|mjs|cjs)$|(^|\/)package\.json$|tsconfig/i],
  ['infra', /^infra\/|terraform|\.tf$|coolify|wrangler/i],
  ['agent', /^\.claude\/|CLAUDE\.md$/i],
];
const GIT_OPTS = { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 };

const sidecarPath = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(sidecarPath)) {
  console.error('usage: node build.mjs <reviews/<slug>.review.json>');
  process.exit(1);
}
const review = JSON.parse(readFileSync(sidecarPath, 'utf8'));
const REVIEWS_DIR = dirname(sidecarPath);
const REPO = resolve(review.repo ?? join(REVIEWS_DIR, '..'));
const SLUG = review.slug ?? basename(sidecarPath).replace(/\.review\.json$/, '');
const SKELETON = join(REVIEWS_DIR, 'skeleton.html');
if (!existsSync(SKELETON)) {
  console.error(`skeleton missing: ${SKELETON} (run init.mjs first)`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: REPO, ...GIT_OPTS });
const gitLenient = (...args) => spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: REPO, ...GIT_OPTS }).stdout ?? '';
const shortSha = (ref) => git('rev-parse', '--short', ref).trim();

function firstParentCommits(train) {
  return git('rev-list', '--first-parent', '--reverse', '--format=%H %s', `${train.base}..${train.head}`)
    .split('\n')
    .filter((line) => line && !line.startsWith('commit '))
    .map((line) => {
      const [sha, ...rest] = line.split(' ');
      const parents = git('rev-list', '--parents', '-n', '1', sha).trim().split(' ').slice(1);
      return { sha, subject: rest.join(' '), parents };
    });
}

function mergeSet(commit) {
  const [first, second] = commit.parents;
  const base = git('merge-base', first, second).trim();
  const match = MERGE_SUBJECT.exec(commit.subject);
  return match
    ? { id: match[1], kind: 'merge', label: `#${match[1]} ${match[2]}`, pr: Number(match[1]), branch: match[2], base, head: second }
    : { id: commit.sha.slice(0, 7), kind: 'merge', label: commit.subject, base, head: second };
}

function trainSets(train) {
  const sets = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0];
    const last = pending[pending.length - 1];
    sets.push({
      id: pending.length === 1 ? first.sha.slice(0, 7) : `fixes-${first.sha.slice(0, 7)}`,
      kind: 'fixes',
      label: pending.length === 1 ? first.subject : `Fixes (${pending.length} commits)`,
      commits: pending.map((commit) => ({ sha: commit.sha.slice(0, 7), subject: commit.subject })),
      base: first.parents[0],
      head: last.sha,
    });
    pending = [];
  };
  for (const commit of firstParentCommits(train)) {
    if (commit.parents.length > 1) {
      flush();
      sets.push(mergeSet(commit));
    } else pending.push(commit);
  }
  flush();
  return sets;
}

function parseNameStatus(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, first, second] = line.split('\t');
      const status = code[0];
      return status === 'R' || status === 'C' ? { status: 'R', oldPath: first, path: second } : { status, path: first };
    });
}

function resolveRenamePath(raw) {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced) return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/\//g, '/');
  return raw.split(' => ')[1];
}

function parseNumstat(text) {
  const stats = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    const [adds, dels, ...pathParts] = line.split('\t');
    const raw = pathParts.join('\t');
    const path = raw.includes(' => ') ? resolveRenamePath(raw) : raw;
    const binary = adds === '-';
    stats.set(path, { adds: binary ? 0 : Number(adds), dels: binary ? 0 : Number(dels), binary });
  }
  return stats;
}

function tierRules(curation) {
  const custom = curation.tierRules ?? {};
  return {
    tests: custom.tests ? new RegExp(custom.tests) : DEFAULT_TIER_RULES.tests,
    generated: custom.generated ? new RegExp(custom.generated) : DEFAULT_TIER_RULES.generated,
  };
}

function classifyTier(path, curated, rules) {
  if (curated?.tier) return curated.tier;
  if (rules.tests.test(path)) return 'tests';
  if (rules.generated.test(path)) return 'generated';
  return 'supporting';
}

function flagsFor(path, status, tier, stat, curated) {
  if (curated?.flags) return curated.flags;
  if (tier === 'tests' || tier === 'generated') return [];
  const flags = FLAG_RULES.filter(([, rule]) => rule.test(path)).map(([id]) => id);
  if (status === 'D') flags.push('deleted');
  if (stat.adds + stat.dels > LARGE_CHURN) flags.push('large');
  return flags;
}

const diffArgs = (set) => (set.kind === 'worktree' ? [set.base ?? 'HEAD'] : [set.base, set.head]);

function trackedEntries(set) {
  const range = diffArgs(set);
  const names = parseNameStatus(git('diff', '--name-status', '-M', ...range));
  const stats = parseNumstat(git('diff', '--numstat', '-M', ...range));
  return names.map((entry) => ({
    entry,
    stat: stats.get(entry.path) ?? { adds: 0, dels: 0, binary: false },
    patch: () => git('diff', '-M', ...range, '--', ...(entry.oldPath ? [entry.oldPath, entry.path] : [entry.path])),
  }));
}

function untrackedEntries() {
  return git('ls-files', '--others', '--exclude-standard')
    .split('\n')
    .filter(Boolean)
    .map((path) => {
      const patch = gitLenient('diff', '--no-index', '/dev/null', path);
      const binary = /^Binary files/m.test(patch);
      const adds = binary ? 0 : patch.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length;
      return { entry: { status: 'A', path }, stat: { adds, dels: 0, binary }, patch: () => patch };
    });
}

function buildFiles(set, curatedFiles, rules, report) {
  const entries = set.kind === 'worktree' ? [...trackedEntries(set), ...untrackedEntries()] : trackedEntries(set);
  return entries.map(({ entry, stat, patch: readPatch }) => {
    const curated = curatedFiles[entry.path];
    let patch = '';
    try {
      patch = readPatch();
    } catch (error) {
      report.failures.push(`${set.label} ${entry.path}: ${error.message.split('\n')[0]}`);
    }
    if (!patch && !stat.binary && (stat.adds || stat.dels)) report.failures.push(`${set.label} ${entry.path}: empty patch`);
    const tier = classifyTier(entry.path, curated, rules);
    const omitted = tier === 'generated' && patch.length > OMIT_PATCH_BYTES;
    if (omitted) report.omitted.push(`${set.label} ${entry.path} (${(patch.length / 1024).toFixed(0)} KB)`);
    return {
      path: entry.path,
      oldPath: entry.oldPath ?? null,
      status: entry.status,
      adds: stat.adds,
      dels: stat.dels,
      binary: stat.binary,
      tier,
      flags: flagsFor(entry.path, entry.status, tier, stat, curated),
      note: curated?.note ?? null,
      omitted,
      patch: omitted ? '' : patch,
    };
  });
}

const startHere = (curatedFiles, files) =>
  Object.keys(curatedFiles)
    .filter((path) => curatedFiles[path].tier === 'core')
    .map((path) => files.findIndex((file) => file.path === path))
    .filter((index) => index >= 0);

const resolveFindings = (setId, findings, files) =>
  findings.map((finding, index) => ({
    id: finding.id ?? `${setId}-F${index + 1}`,
    severity: finding.severity ?? 'medium',
    verdict: finding.verdict ?? null,
    ...finding,
    fileIndex: files.findIndex((file) => file.path === finding.file || file.oldPath === finding.file),
  }));

function buildSet(set, curation, rules, report) {
  const entry = curation.sets?.[set.id] ?? {};
  const curatedFiles = entry.files ?? {};
  const files = buildFiles(set, curatedFiles, rules, report);
  for (const path of Object.keys(curatedFiles)) {
    if (!files.some((file) => file.path === path)) report.missing.push(`${set.label} ${path}`);
  }
  return {
    ...set,
    title: entry.title ?? set.label,
    summary: entry.summary ?? '',
    findings: resolveFindings(set.id, entry.findings ?? [], files),
    startHere: startHere(curatedFiles, files),
    adds: files.reduce((sum, file) => sum + file.adds, 0),
    dels: files.reduce((sum, file) => sum + file.dels, 0),
    files,
  };
}

function resolveSets() {
  const derived = review.train ? trainSets(review.train) : [];
  const explicit = (review.changeSets ?? []).map((set) => ({ ...set, label: set.label ?? set.id }));
  return [...derived, ...explicit];
}

const escapeJsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function fillSkeleton(skeleton, data) {
  const pattern = /(<script id="review-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!pattern.test(skeleton)) throw new Error('skeleton has no <script id="review-data" type="application/json"> placeholder');
  return skeleton.replace(pattern, (_, open, close) => open + escapeJsonForScript(data) + close).replace(/<title>[\s\S]*?<\/title>/, `<title>${data.meta.title}</title>`);
}

function main() {
  const curation = review.curation ?? {};
  const report = { failures: [], missing: [], omitted: [] };
  const rules = tierRules(curation);
  const sets = resolveSets()
    .map((set) => buildSet(set, curation, rules, report))
    .filter((set) => set.kind !== 'worktree' || set.files.length);
  const base = review.base ?? review.train?.base ?? '';
  const head = review.head ?? review.train?.head ?? '';
  const data = {
    meta: {
      title: review.title ?? curation.title ?? `Review ${SLUG}`,
      lead: review.lead ?? curation.lead ?? '',
      mode: review.mode ?? 'branch',
      depth: review.depth ?? 'light',
      base,
      head,
      baseSha: base ? shortSha(base) : '',
      headSha: head ? shortSha(head) : '',
      generatedAt: new Date().toISOString(),
      slug: SLUG,
    },
    sets,
    verification: curation.verification ?? null,
    decisions: curation.decisions ?? [],
    usage: review.usage ?? null,
  };
  const html = fillSkeleton(readFileSync(SKELETON, 'utf8'), data);
  const out = join(REVIEWS_DIR, `${SLUG}.html`);
  writeFileSync(out, html);
  console.log(`${out} ${(html.length / 1024 / 1024).toFixed(2)} MB`);
  for (const set of sets) console.log(`${set.label}: ${set.files.length} files +${set.adds} -${set.dels}, ${set.findings.length} findings`);
  const list = (items) => (items.length ? '\n' + items.join('\n') : 'none');
  console.log(`diff failures: ${list(report.failures)}`);
  console.log(`curated paths not in change set: ${list(report.missing)}`);
  console.log(`patches omitted (generated over ${OMIT_PATCH_BYTES / 1000} KB): ${list(report.omitted)}`);
}

main();
