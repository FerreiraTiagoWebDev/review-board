import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { TIERS } from './classify.mjs';

export const MODES = ['train', 'pr', 'branch', 'range', 'worktree'];
export const DEPTHS = ['full', 'light'];
export const SET_KINDS = ['merge', 'pr', 'branch', 'range', 'worktree', 'fixes', 'commit'];
export const SEVERITIES = ['low', 'medium', 'high'];
export const VERDICTS = ['CONFIRMED', 'PLAUSIBLE'];
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export class SidecarError extends Error {
  /** @param {string} path @param {string[]} problems */
  constructor(path, problems) {
    super(`${path} is not a valid sidecar:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'SidecarError';
    this.problems = problems;
  }
}

/** @param {string} path */
export function readJson(path) {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SidecarError(path, [`not JSON: ${/** @type {Error} */ (error).message}`]);
  }
}

/** Writes through a temp file so an interrupted write never leaves a truncated file. */
export function writeFileAtomic(path, content) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

export const writeJson = (path, value) => writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isText = (value) => typeof value === 'string' && value.length > 0;
const isId = (value) => isText(value) || Number.isInteger(value);

/**
 * Returns every problem found, so one run of the build reports all of them.
 * @param {unknown} review
 * @returns {string[]}
 */
export function validateSidecar(review) {
  const problems = [];
  const check = (ok, message) => {
    if (!ok) problems.push(message);
  };
  if (!isObject(review)) return ['top level must be an object'];

  for (const key of ['slug', 'title', 'lead', 'repo', 'base', 'head', 'sessionId', 'transcript']) {
    check(review[key] == null || typeof review[key] === 'string', `${key} must be a string`);
  }
  check(review.mode == null || MODES.includes(review.mode), `mode must be one of ${MODES.join(', ')}`);
  check(review.depth == null || DEPTHS.includes(review.depth), `depth must be one of ${DEPTHS.join(', ')}`);

  if (review.train != null) {
    check(isObject(review.train) && isText(review.train.base) && isText(review.train.head), 'train needs string base and head');
  }

  const sets = review.changeSets ?? [];
  if (!Array.isArray(sets)) problems.push('changeSets must be an array');
  else {
    sets.forEach((set, index) => {
      const at = `changeSets[${index}]`;
      if (!isObject(set)) {
        problems.push(`${at} must be an object`);
        return;
      }
      check(isId(set.id) && SAFE_ID.test(String(set.id)), `${at}.id must be letters, digits, ".", "_" or "-"`);
      check(set.kind == null || SET_KINDS.includes(set.kind), `${at}.kind must be one of ${SET_KINDS.join(', ')}`);
      if (set.kind === 'worktree') check(set.base == null || isText(set.base), `${at}.base must be a string`);
      else check(isText(set.base) && isText(set.head), `${at} needs base and head (only kind "worktree" may omit them)`);
    });
    const ids = sets.filter(isObject).map((set) => String(set.id));
    for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) problems.push(`change set id "${id}" is used twice`);
  }
  if (!review.train && Array.isArray(sets) && sets.length === 0) problems.push('nothing to review: no train and no changeSets');

  const curation = review.curation ?? {};
  if (!isObject(curation)) problems.push('curation must be an object');
  else validateCuration(curation, problems);

  if (review.phases != null) check(Array.isArray(review.phases), 'phases must be an array');
  return problems;
}

function validateCuration(curation, problems) {
  const check = (ok, message) => {
    if (!ok) problems.push(message);
  };
  for (const [name, source] of Object.entries(curation.tierRules ?? {})) {
    try {
      new RegExp(source);
    } catch (error) {
      problems.push(`curation.tierRules.${name} is not a valid regex: ${/** @type {Error} */ (error).message}`);
    }
  }

  const findingIds = new Map();
  for (const [setId, entry] of Object.entries(curation.sets ?? {})) {
    const at = `curation.sets.${setId}`;
    if (!isObject(entry)) {
      problems.push(`${at} must be an object`);
      continue;
    }
    for (const [path, file] of Object.entries(entry.files ?? {})) {
      const fileAt = `${at}.files["${path}"]`;
      if (!isObject(file)) {
        problems.push(`${fileAt} must be an object`);
        continue;
      }
      check(file.tier == null || TIERS.includes(file.tier), `${fileAt}.tier must be one of ${TIERS.join(', ')}`);
      check(file.tier !== 'core' || isText(file.note), `${fileAt} is core and needs a note`);
      check(file.flags == null || (Array.isArray(file.flags) && file.flags.every(isText)), `${fileAt}.flags must be an array of strings`);
    }
    const findings = entry.findings ?? [];
    if (!Array.isArray(findings)) {
      problems.push(`${at}.findings must be an array`);
      continue;
    }
    findings.forEach((finding, index) => {
      const findingAt = `${at}.findings[${index}]`;
      if (!isObject(finding)) {
        problems.push(`${findingAt} must be an object`);
        return;
      }
      check(isText(finding.text), `${findingAt}.text is required`);
      check(finding.severity == null || SEVERITIES.includes(finding.severity), `${findingAt}.severity must be one of ${SEVERITIES.join(', ')}`);
      check(finding.verdict == null || VERDICTS.includes(finding.verdict), `${findingAt}.verdict must be one of ${VERDICTS.join(', ')}`);
      check(finding.file == null || isText(finding.file), `${findingAt}.file must be a string`);
      check(finding.line == null || (Number.isInteger(finding.line) && finding.line > 0), `${findingAt}.line must be a positive integer`);
      const id = finding.id ?? `${setId}-F${index + 1}`;
      if (findingIds.has(id)) problems.push(`finding id "${id}" is used by ${findingIds.get(id)} and ${findingAt}`);
      else findingIds.set(id, findingAt);
    });
  }

  const verification = curation.verification;
  if (verification != null) {
    const rows = verification.rows;
    if (!Array.isArray(rows)) problems.push('curation.verification.rows must be an array');
    else {
      rows.forEach((row, index) => {
        check(isText(row?.check) && isText(row?.result), `curation.verification.rows[${index}] needs check and result`);
      });
    }
  }

  const decisions = curation.decisions ?? [];
  if (!Array.isArray(decisions)) problems.push('curation.decisions must be an array');
  else {
    decisions.forEach((decision, index) => {
      const at = `curation.decisions[${index}]`;
      check(isId(decision?.id) && isText(decision?.title), `${at} needs id and title`);
      check(Array.isArray(decision?.options) && decision.options.length >= 2 && decision.options.every(isText), `${at}.options needs at least two strings`);
    });
  }
}

/** @param {string} path */
export function loadSidecar(path) {
  const review = readJson(path);
  const problems = validateSidecar(review);
  if (problems.length) throw new SidecarError(path, problems);
  return review;
}
