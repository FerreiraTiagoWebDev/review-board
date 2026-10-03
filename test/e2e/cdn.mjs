import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const CDN_HAR = join(ROOT, '.cache', 'e2e', 'esm.sh.har');
export const FIXTURES_JSON = join(ROOT, '.cache', 'e2e', 'fixtures.json');
const CDN = /^https:\/\/esm\.sh\//;

export const fixturePages = () => JSON.parse(readFileSync(FIXTURES_JSON, 'utf8'));

/** Records every esm.sh response the page needs once, so test runs replay them offline. */
export async function recordCdn(pagePath) {
  rmSync(CDN_HAR, { force: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ recordHar: { path: CDN_HAR, urlFilter: CDN, content: 'embed' } });
  const page = await context.newPage();
  await page.goto(`file://${pagePath}`);
  await page.locator('#tree .file').first().click();
  await page.locator('#diffmount diffs-container').waitFor();
  await page.waitForLoadState('networkidle');
  await context.close();
  await browser.close();
}

/**
 * Replays the recorded CDN; LIVE_CDN=1 goes to the real esm.sh instead, to check it still serves the pinned version.
 * @param {import('@playwright/test').Page} page
 */
export async function serveCdn(page) {
  if (process.env.LIVE_CDN) return;
  if (!existsSync(CDN_HAR)) throw new Error(`missing ${CDN_HAR}`);
  await page.routeFromHAR(CDN_HAR, { url: CDN, notFound: 'abort' });
}
