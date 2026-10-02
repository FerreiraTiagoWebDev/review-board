import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKELETON_SOURCE = join(HERE, '..', 'assets', 'skeleton.html');
const IGNORE_BLOCK = ['reviews/*.html', '!reviews/skeleton.html', 'reviews/*.review.json'];

const project = resolve(process.argv[2] ?? process.cwd());
const reviews = join(project, 'reviews');
const skeleton = join(reviews, 'skeleton.html');
const gitignore = join(project, '.gitignore');
const done = [];

if (!existsSync(reviews)) {
  mkdirSync(reviews);
  done.push(`created ${reviews}`);
}
if (!existsSync(skeleton)) {
  copyFileSync(SKELETON_SOURCE, skeleton);
  done.push(`copied skeleton.html (edit it to restyle every review in this project)`);
} else done.push('skeleton.html already present, kept');

const current = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : '';
const missing = IGNORE_BLOCK.filter((line) => !current.split('\n').some((existing) => existing.trim() === line));
if (missing.length) {
  const block = (current && !current.endsWith('\n') ? '\n' : '') + (current ? '\n' : '') + '# review-board: generated review pages stay local, the skeleton is shared\n' + missing.join('\n') + '\n';
  writeFileSync(gitignore, current + block);
  done.push(`gitignore: added ${missing.join(', ')}`);
} else done.push('gitignore already covers reviews/');

console.log(done.join('\n'));
console.log(`reviews dir: ${reviews}`);
