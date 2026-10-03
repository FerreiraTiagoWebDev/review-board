import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { SCRIPTS, SKILL_DIR, tempDir } from '../helpers/repo.mjs';

const init = (cwd, ...args) => spawnSync(process.execPath, [join(SCRIPTS, 'init.mjs'), ...args], { cwd, encoding: 'utf8' });

describe('init', () => {
  test('creates reviews/, copies the skeleton, extends .gitignore, and is idempotent', (t) => {
    const project = tempDir(t);
    writeFileSync(join(project, '.gitignore'), 'node_modules/');
    const first = init(project);
    assert.equal(first.status, 0, first.stderr);
    assert.match(
      first.stdout,
      /created .*reviews\ncopied skeleton\.html.*\ngitignore: added reviews\/\*\.html, !reviews\/skeleton\.html, reviews\/\*\.review\.json\nreviews dir: /,
    );
    assert.equal(readFileSync(join(project, 'reviews', 'skeleton.html'), 'utf8'), readFileSync(join(SKILL_DIR, 'assets', 'skeleton.html'), 'utf8'));

    writeFileSync(join(project, 'reviews', 'skeleton.html'), '<!-- restyled -->');
    const gitignore = readFileSync(join(project, '.gitignore'), 'utf8');
    const second = init(project);
    assert.match(second.stdout, /skeleton\.html already present, kept\ngitignore already covers reviews\//);
    assert.equal(readFileSync(join(project, 'reviews', 'skeleton.html'), 'utf8'), '<!-- restyled -->');
    assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), gitignore);
  });

  test('takes the project path as an argument and fails clearly when it does not exist', (t) => {
    const project = tempDir(t);
    assert.equal(init('/', project).status, 0);
    const missing = init('/', join(project, 'nope'));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /project directory not found/);
  });
});
