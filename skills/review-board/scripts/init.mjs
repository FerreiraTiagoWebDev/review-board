import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, run } from './lib/cli.mjs';

const SKELETON_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'skeleton.html');
export const IGNORE_LINES = ['reviews/*.html', '!reviews/skeleton.html', 'reviews/*.review.json'];
const IGNORE_HEADER = '# review-board: generated review pages stay local, the skeleton is shared';

/** @param {string} current */
export function withIgnoreBlock(current) {
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORE_LINES.filter((line) => !present.has(line));
  if (!missing.length) return { content: current, missing };
  const separator = current === '' ? '' : current.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${current}${separator}${IGNORE_HEADER}\n${missing.join('\n')}\n`, missing };
}

/** @param {string} project */
export function init(project) {
  const reviews = join(project, 'reviews');
  const skeleton = join(reviews, 'skeleton.html');
  const gitignore = join(project, '.gitignore');
  const done = [];
  if (!existsSync(project)) throw new Error(`project directory not found: ${project}`);
  if (!existsSync(reviews)) {
    mkdirSync(reviews);
    done.push(`created ${reviews}`);
  }
  if (!existsSync(skeleton)) {
    copyFileSync(SKELETON_SOURCE, skeleton);
    done.push('copied skeleton.html (edit it to restyle every review in this project)');
  } else done.push('skeleton.html already present, kept');
  const { content, missing } = withIgnoreBlock(existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '');
  if (!missing.length) done.push('gitignore already covers reviews/');
  else {
    writeFileSync(gitignore, content);
    done.push(`gitignore: added ${missing.join(', ')}`);
  }
  done.push(`reviews dir: ${reviews}`);
  return done;
}

if (isMain(import.meta.url)) run(() => console.log(init(resolve(process.argv[2] ?? process.cwd())).join('\n')));
