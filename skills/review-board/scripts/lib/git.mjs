import { spawnSync } from 'node:child_process';

const MAX_BUFFER = 512 * 1024 * 1024;

export class GitError extends Error {
  constructor(args, status, stderr) {
    super(`git ${args.join(' ')} failed (exit ${status}): ${stderr.trim().split('\n')[0] || 'no output'}`);
    this.name = 'GitError';
    this.status = status;
  }
}

/** @typedef {(args: string[], options?: { okStatus?: number[] }) => string} Git */

/**
 * @param {string} cwd
 * @returns {Git}
 */
export function createGit(cwd) {
  return (args, { okStatus = [0] } = {}) => {
    const full = ['-c', 'core.quotepath=off', ...args];
    const result = spawnSync('git', full, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
    if (result.error) throw result.error;
    if (!okStatus.includes(result.status ?? -1)) throw new GitError(args, result.status, result.stderr ?? '');
    return result.stdout;
  };
}

/** @param {string} text */
export function splitNul(text) {
  const parts = text.split('\0');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}
