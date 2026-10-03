import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../../skills/review-board/scripts/build.mjs';
import { createRepo, writeSidecar } from '../helpers/repo.mjs';

const lines = (count, prefix) => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n') + '\n';

/** Builds the boards the browser tests open in a temp repo. Returns the repo dir and the path of each page. */
export function buildFixtures() {
  const repo = createRepo(mkdtempSync(join(tmpdir(), 'review-board-e2e-')));
  repo.write('src/session.ts', lines(30, 'export const value'));
  repo.write('src/util/format.ts', 'export const format = (x) => String(x);\n');
  const base = repo.commit('base');
  repo.git('checkout', '--quiet', '-b', 'feat/ttl');
  repo.write('src/session.ts', lines(30, 'export const value').replace('value 12', 'ttlSeconds 12'));
  repo.write('src/auth/guard.ts', 'export const guard = () => true;\n');
  repo.write('src/auth/guard.test.ts', 'test("guard", () => {});\n');
  repo.commit('feat: ttl');
  repo.git('checkout', '--quiet', '-b', 'feat/format', base);
  repo.write('src/util/format.ts', 'export const format = (x) => x.toString();\n');
  repo.commit('feat: format');
  repo.git('checkout', '--quiet', '-b', 'chore/merge-train', base);
  repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #11 feat/ttl into merge train', 'feat/ttl');
  repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #12 feat/format into merge train', 'feat/format');

  const train = writeSidecar(repo, {
    slug: 'train',
    title: 'Merge train <2> → main',
    lead: 'Two PRs merged locally; nothing pushed.',
    mode: 'train',
    depth: 'full',
    train: { base, head: 'chore/merge-train' },
    curation: {
      sets: {
        11: {
          title: 'Session ttl',
          summary: 'Adds a **ttl** to sessions.\n\n- guarded by `guard`\n- seconds, not ms',
          files: {
            'src/session.ts': { tier: 'core', note: 'Where the ttl is read.' },
            'src/auth/guard.ts': { tier: 'core', note: 'New guard.' },
          },
          findings: [
            { severity: 'high', verdict: 'CONFIRMED', file: 'src/session.ts', line: 12, text: 'ttl is seconds, callers pass ms.' },
            { severity: 'low', verdict: 'PLAUSIBLE', file: 'src/auth/guard.ts', line: 1, text: 'guard always returns true.' },
          ],
        },
        12: { title: 'Shorter format', summary: 'Same output, shorter.' },
      },
      verification: {
        lead: 'Measured on the train head.',
        rows: [
          { check: 'pnpm test', result: 'pass' },
          { check: 'pnpm lint', result: '1 fail, pre-existing' },
        ],
      },
      decisions: [{ id: 'D1', title: 'Push the train and open one PR', options: ['Push and open the PR now', 'Wait for the findings batch first'] }],
    },
  });
  const empty = writeSidecar(repo, { slug: 'empty', title: 'Clean tree', changeSets: [{ id: 'worktree', kind: 'worktree' }] });
  return { dir: repo.dir, pages: { train: build(train).out, empty: build(empty).out } };
}
