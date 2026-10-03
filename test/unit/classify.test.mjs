import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyTier, flagsFor, LARGE_CHURN, tierRules } from '../../skills/review-board/scripts/lib/classify.mjs';

const rules = tierRules();

describe('classifyTier', () => {
  test('curated tier wins', () => {
    assert.equal(classifyTier('src/a.test.ts', { tier: 'core' }, rules), 'core');
  });

  test('default rules', () => {
    for (const path of ['src/a.spec.ts', 'src/a.test.tsx', 'test/run.mjs', 'pkg/tests/x.py', 'src/__tests__/x.js', 'api/x.integration-spec.ts']) {
      assert.equal(classifyTier(path, undefined, rules), 'tests', path);
    }
    for (const path of ['routeTree.gen.ts', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'Cargo.lock', 'x/__snapshots__/a.snap']) {
      assert.equal(classifyTier(path, undefined, rules), 'generated', path);
    }
    assert.equal(classifyTier('src/latest/index.ts', undefined, rules), 'supporting');
  });

  test('custom rules replace the defaults per tier', () => {
    const custom = tierRules({ tests: '^e2e/' });
    assert.equal(classifyTier('e2e/login.ts', undefined, custom), 'tests');
    assert.equal(classifyTier('src/a.spec.ts', undefined, custom), 'supporting');
    assert.equal(classifyTier('pnpm-lock.yaml', undefined, custom), 'generated');
  });
});

describe('flagsFor', () => {
  const flags = (path, extra = {}) => flagsFor({ path, status: 'M', tier: 'supporting', churn: 10, ...extra });

  test('path rules', () => {
    assert.deepEqual(flags('prisma/schema.prisma'), ['schema']);
    assert.deepEqual(flags('src/auth/guard.ts'), ['auth']);
    assert.deepEqual(flags('src/routes/users.ts'), ['api']);
    assert.deepEqual(flags('.github/workflows/ci.yml'), ['config']);
    assert.deepEqual(flags('infra/main.tf'), ['infra']);
    assert.deepEqual(flags('.claude/settings.json'), ['agent']);
    assert.deepEqual(flags('src/util/strings.ts'), []);
  });

  test('deletion and churn', () => {
    assert.deepEqual(flags('src/x.ts', { status: 'D' }), ['deleted']);
    assert.deepEqual(flags('src/x.ts', { churn: LARGE_CHURN + 1 }), ['large']);
    assert.deepEqual(flags('src/x.ts', { churn: LARGE_CHURN }), []);
  });

  test('tests and generated files carry no flags; curated flags replace computed ones', () => {
    assert.deepEqual(flags('src/auth.test.ts', { tier: 'tests' }), []);
    assert.deepEqual(flags('src/auth.ts', { curated: { flags: ['config'] } }), ['config']);
  });
});
