import { trackedEntries, trainSets, untrackedEntries } from './changes.mjs';
import { classifyTier, flagsFor, tierRules } from './classify.mjs';

export const OMIT_PATCH_BYTES = 100_000;

/**
 * @typedef {{ failures: string[], missing: string[], omitted: string[] }} BuildReport
 */

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

function buildFiles(git, set, curatedFiles, rules, report, excludes) {
  const entries = set.kind === 'worktree' ? [...trackedEntries(git, set, excludes), ...untrackedEntries(git, excludes)] : trackedEntries(git, set);
  return entries.map(({ entry, stat, patch: readPatch }) => {
    const curated = curatedFiles[entry.path];
    let patch = '';
    try {
      patch = readPatch();
    } catch (error) {
      report.failures.push(`${set.label} ${entry.path}: ${firstLine(error)}`);
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
      flags: flagsFor({ path: entry.path, status: entry.status, tier, churn: stat.adds + stat.dels, curated }),
      note: curated?.note ?? null,
      omitted,
      patch: omitted ? '' : patch,
    };
  });
}

const indexOfPath = (files, path) => files.findIndex((file) => file.path === path || file.oldPath === path);

export const startHere = (curatedFiles, files) =>
  Object.keys(curatedFiles)
    .filter((path) => curatedFiles[path].tier === 'core')
    .map((path) => indexOfPath(files, path))
    .filter((index) => index >= 0);

export const resolveFindings = (setId, findings, files) =>
  findings.map((finding, index) => ({
    ...finding,
    id: finding.id ?? `${setId}-F${index + 1}`,
    severity: finding.severity ?? 'medium',
    verdict: finding.verdict ?? null,
    fileIndex: finding.file ? indexOfPath(files, finding.file) : -1,
  }));

function buildSet(git, set, curation, rules, report, excludes) {
  const entry = curation.sets?.[set.id] ?? {};
  const curatedFiles = entry.files ?? {};
  const files = buildFiles(git, set, curatedFiles, rules, report, excludes);
  for (const path of Object.keys(curatedFiles)) {
    if (indexOfPath(files, path) < 0) report.missing.push(`${set.label} ${path}`);
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

/** Fails early with a readable message instead of a git stack trace halfway through the build. */
function assertRefs(git, sets) {
  const problems = [];
  for (const set of sets) {
    for (const key of set.kind === 'worktree' ? ['base'] : ['base', 'head']) {
      const ref = set[key] ?? (key === 'base' ? 'HEAD' : undefined);
      try {
        git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      } catch {
        problems.push(`change set "${set.id}": ${key} "${ref}" is not a commit in this repo`);
      }
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

/**
 * `worktreeExcludes` keeps the review tooling's own files (the reviews/ dir) out of the working tree set.
 * @param {{ review: any, slug: string, git: import('./git.mjs').Git, now?: Date, worktreeExcludes?: string[] }} input
 */
export function buildBoard({ review, slug, git, now = new Date(), worktreeExcludes = [] }) {
  const curation = review.curation ?? {};
  /** @type {BuildReport} */
  const report = { failures: [], missing: [], omitted: [] };
  const rules = tierRules(curation.tierRules);
  const derived = review.train ? trainSets(git, review.train) : [];
  const explicit = (review.changeSets ?? []).map((set) => ({ ...set, id: String(set.id), label: set.label ?? String(set.id) }));
  const resolved = [...derived, ...explicit];
  assertRefs(git, resolved);
  const sets = resolved
    .map((set) => buildSet(git, set, curation, rules, report, worktreeExcludes))
    .filter((set) => set.kind !== 'worktree' || set.files.length);
  const base = review.base ?? review.train?.base ?? '';
  const head = review.head ?? review.train?.head ?? '';
  const shortSha = (ref) => git(['rev-parse', '--short', ref]).trim();
  const { transcript: _localPath, ...usage } = review.usage ?? {};
  const data = {
    meta: {
      title: review.title ?? curation.title ?? `Review ${slug}`,
      lead: review.lead ?? curation.lead ?? '',
      mode: review.mode ?? 'branch',
      depth: review.depth ?? 'light',
      base,
      head,
      baseSha: base ? shortSha(base) : '',
      headSha: head ? shortSha(head) : '',
      generatedAt: now.toISOString(),
      slug,
    },
    sets,
    verification: curation.verification ?? null,
    decisions: curation.decisions ?? [],
    usage: review.usage ? usage : null,
  };
  return { data, report };
}

/** @param {{ data: any, report: BuildReport }} board @param {string} out @param {number} bytes */
export function formatReport({ data, report }, out, bytes) {
  const list = (items) => (items.length ? `\n${items.join('\n')}` : 'none');
  return [
    `${out} ${(bytes / 1024 / 1024).toFixed(2)} MB`,
    ...data.sets.map((set) => `${set.label}: ${set.files.length} files +${set.adds} -${set.dels}, ${set.findings.length} findings`),
    `diff failures: ${list(report.failures)}`,
    `curated paths not in change set: ${list(report.missing)}`,
    `patches omitted (generated over ${OMIT_PATCH_BYTES / 1000} KB): ${list(report.omitted)}`,
  ].join('\n');
}
