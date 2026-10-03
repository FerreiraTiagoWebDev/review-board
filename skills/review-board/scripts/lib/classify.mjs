export const TIERS = ['core', 'supporting', 'tests', 'generated'];
export const LARGE_CHURN = 300;

export const DEFAULT_TIER_RULES = {
  tests: /\.spec\.|\.test\.|\.integration-spec\.|(^|\/)tests?\/|(^|\/)__tests__\//,
  generated: /(\.gen\.ts|\.snap|\.generated\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|\.lock)$/,
};

/** @type {[string, RegExp][]} */
export const FLAG_RULES = [
  ['schema', /(^|\/)prisma\/|(^|\/)migrations\//i],
  ['auth', /auth|security|crypto|cipher|token|secret|password|hmac|signed|permission|guard|roles?\b/i],
  ['api', /controller|(^|\/)routes?\/|(^|\/)api\/|route\.(ts|tsx|js)$|webhook|resolver|gateway/i],
  ['config', /(^|\/)\.env|(^|\/)env\/|\.ya?ml$|Dockerfile|(^|\/)\.github\/|\.config\.(ts|js|mjs|cjs)$|(^|\/)package\.json$|tsconfig/i],
  ['infra', /^infra\/|terraform|\.tf$|coolify|wrangler/i],
  ['agent', /^\.claude\/|CLAUDE\.md$/i],
];

/** @param {{ tests?: string, generated?: string }} [custom] */
export function tierRules(custom = {}) {
  return {
    tests: custom.tests ? new RegExp(custom.tests) : DEFAULT_TIER_RULES.tests,
    generated: custom.generated ? new RegExp(custom.generated) : DEFAULT_TIER_RULES.generated,
  };
}

/**
 * @param {string} path
 * @param {{ tier?: string } | undefined} curated
 * @param {ReturnType<typeof tierRules>} rules
 */
export function classifyTier(path, curated, rules) {
  if (curated?.tier) return curated.tier;
  if (rules.tests.test(path)) return 'tests';
  if (rules.generated.test(path)) return 'generated';
  return 'supporting';
}

/**
 * @param {{ path: string, status: string, tier: string, churn: number, curated?: { flags?: string[] } }} file
 */
export function flagsFor({ path, status, tier, churn, curated }) {
  if (curated?.flags) return curated.flags;
  if (tier === 'tests' || tier === 'generated') return [];
  const flags = FLAG_RULES.filter(([, rule]) => rule.test(path)).map(([id]) => id);
  if (status === 'D') flags.push('deleted');
  if (churn > LARGE_CHURN) flags.push('large');
  return flags;
}
