import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'review-board');
export const SCRIPTS = join(SKILL_DIR, 'scripts');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

export function tempDir(t, prefix = 'review-board-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A throwaway git repo with helpers to write files and commit. */
export const makeRepo = (t) => createRepo(tempDir(t));

/** @param {string} dir an empty directory */
export function createRepo(dir) {
  const git = (...args) => execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' }).trim();
  git('init', '--quiet', '--initial-branch=main');
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (message) => {
    git('add', '--all');
    git('commit', '--quiet', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, write, commit };
}

/** Copies the shipped skeleton into <repo>/reviews and writes a sidecar there. */
export function writeSidecar(repo, review) {
  const reviews = join(repo.dir, 'reviews');
  mkdirSync(reviews, { recursive: true });
  cpSync(join(SKILL_DIR, 'assets', 'skeleton.html'), join(reviews, 'skeleton.html'));
  const path = join(reviews, `${review.slug ?? 'test'}.review.json`);
  writeFileSync(path, JSON.stringify(review, null, 2));
  return path;
}

/** Reads the page data back out of a built page. */
export function pageData(html) {
  const match = /<script id="review-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('no review-data in page');
  return JSON.parse(match[1]);
}
