import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { buildBoard, formatReport } from './lib/board.mjs';
import { isMain, run } from './lib/cli.mjs';
import { createGit } from './lib/git.mjs';
import { fillSkeleton } from './lib/page.mjs';
import { loadSidecar, writeFileAtomic } from './lib/sidecar.mjs';

const USAGE = 'usage: node build.mjs <reviews/<slug>.review.json>';

/** @param {string} sidecarArg @param {{ now?: Date }} [options] */
export function build(sidecarArg, { now } = {}) {
  const sidecarPath = resolve(sidecarArg);
  if (!existsSync(sidecarPath)) throw new Error(`sidecar not found: ${sidecarPath}\n${USAGE}`);
  const review = loadSidecar(sidecarPath);
  const reviewsDir = dirname(sidecarPath);
  const skeletonPath = join(reviewsDir, 'skeleton.html');
  if (!existsSync(skeletonPath)) throw new Error(`skeleton missing: ${skeletonPath} (run init.mjs first)`);
  const repo = resolve(review.repo ?? join(reviewsDir, '..'));
  const slug = review.slug ?? basename(sidecarPath).replace(/\.review\.json$/, '');
  const reviewsInRepo = relative(repo, reviewsDir);
  const worktreeExcludes = reviewsInRepo && !reviewsInRepo.startsWith('..') ? [reviewsInRepo.split(sep).join('/')] : [];
  const board = buildBoard({ review, slug, git: createGit(repo), now, worktreeExcludes });
  const html = fillSkeleton(readFileSync(skeletonPath, 'utf8'), board.data);
  const out = join(reviewsDir, `${slug}.html`);
  writeFileAtomic(out, html);
  return { out, html, ...board };
}

if (isMain(import.meta.url)) {
  run(() => {
    const arg = process.argv[2];
    if (!arg || arg === '--help') {
      console.log(USAGE);
      if (!arg) process.exitCode = 1;
      return;
    }
    const result = build(arg);
    console.log(formatReport(result, result.out, Buffer.byteLength(result.html)));
  });
}
