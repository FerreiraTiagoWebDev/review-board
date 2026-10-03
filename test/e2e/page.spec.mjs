import { expect, test } from '@playwright/test';
import { fixturePages, serveCdn } from './cdn.mjs';

const pages = fixturePages();

/** Opens a built board and fails the test on any page error or console error. */
async function open(page, name) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await serveCdn(page);
  await page.goto(`file://${pages[name]}`);
  return errors;
}

const fileRow = (page, name) => page.locator('#tree .file', { has: page.locator('.name', { hasText: name }) });
const diffLines = (page) => page.locator('#diffmount diffs-container').locator('[data-line]');
const activeTab = (page) => page.locator('#tabs .tab.on .label');

test.describe('train board', () => {
  test('renders without errors and escapes the title', async ({ page }) => {
    const errors = await open(page, 'train');
    await expect(page).toHaveTitle('Merge train <2> → main');
    await expect(page.locator('.top h1')).toHaveText('Merge train <2> → main');
    await expect(page.locator('.top .lead')).toHaveText('Two PRs merged locally; nothing pushed.');
    await expect(page.locator('#chips .step')).toHaveText([/All\s*4 files · 2 findings/, /#11 ttl\s*3 files · 2 findings/, /#12 format\s*1 file/]);
    await expect(page.locator('#tree .row.group')).toHaveText([/Core\s*2\s*read first/, /Supporting\s*1/, /Tests & generated\s*1/]);
    await expect(page.locator('#tree .file')).toHaveCount(3);
    await expect(activeTab(page)).toHaveText('Overview');
    await expect(page.locator('#statusbar [data-tab="overview"]')).toHaveText(/1\s*0\s*1/);
    await expect(page.locator('.ask')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the overview answers what to read first and what to check carefully, then checks and decisions', async ({ page }) => {
    await open(page, 'train');
    const body = page.locator('.editor-body');
    await expect(body.locator('.ov-set h2')).toHaveText(['#11 feat/ttl', '#12 feat/format']);
    const first = body.locator('.ov-set').first();
    await expect(first.locator('.ov-sec').nth(0).locator('h3')).toContainText('Read first');
    await expect(first.locator('.ov-sec').nth(0).locator('.item')).toHaveText([
      /1\s*session\.ts\s*src\s*Where the ttl is read\./,
      /2\s*guard\.ts\s*src\/auth\s*New guard\./,
    ]);
    const check = first.locator('.ov-sec').nth(1);
    await expect(check.locator('h3')).toContainText('Check carefully');
    await expect(check.locator('> ul > .item')).toHaveCount(2);
    await expect(check.locator('> ul > .item').first()).toContainText('session.ts');
    await expect(check.locator('> ul > .item').first().locator('[data-finding="11-F1"]')).toContainText('ttl is seconds, callers pass ms.');
    await expect(check.locator('> ul > .item').nth(1)).toContainText('Auth, tokens & secrets');
    await expect(check.locator('> ul > .item').nth(1).locator('[data-finding="11-F2"]')).toContainText('guard always returns true.');
    await expect(body.locator('#verification .vrow')).toHaveText([/pnpm test\s*pass/, /pnpm lint\s*1 fail, pre-existing/]);
    await expect(body.locator('#decisions .dec li')).toHaveText(['Push and open the PR now', 'Wait for the findings batch first']);
  });

  test('a chip selects a change set: the tree and the overview follow', async ({ page }) => {
    await open(page, 'train');
    await page.locator('#chips .step[data-set="12"]').click();
    await expect(page.locator('#chips .step.on')).toHaveAttribute('data-set', '12');
    await expect(page.locator('#tree .file')).toHaveCount(1);
    await expect(page.locator('.editor-body .ov-set h2')).toHaveText(['#12 feat/format']);
    await expect(page.locator('.editor-body .ov-set .ov-sec').nth(1)).toContainText('Nothing flagged by path and code review found nothing to report.');
  });

  test('opening a file shows one file tab, its risk flags and note above the diff, and the finding pinned to its line', async ({ page }) => {
    const errors = await open(page, 'train');
    await fileRow(page, 'session.ts').click();
    await expect(activeTab(page)).toHaveText('session.ts');
    await expect(page.locator('#filebar .note')).toHaveText('Where the ttl is read.');
    await expect(diffLines(page).first()).toBeVisible();
    await expect(page.locator('#diffmount')).toContainText('ttl is seconds, callers pass ms.');
    await fileRow(page, 'guard.ts').click();
    await expect(page.locator('#tabs .tab')).toHaveCount(2);
    await expect(activeTab(page)).toHaveText('guard.ts');
    await expect(page.locator('#filebar .flag')).toHaveText('Auth, tokens & secrets');
    await page.locator('#tabs .tab-close').click();
    await expect(activeTab(page)).toHaveText('Overview');
    await expect(page.locator('#tabs .tab')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a finding line link opens the file and scrolls its annotation into view', async ({ page }) => {
    await open(page, 'train');
    await page.locator('.editor-body [data-finding-id="11-F1"]').click();
    await expect(activeTab(page)).toHaveText('session.ts');
    await expect(page.locator('#diffmount [data-finding="11-F1"]')).toBeInViewport();
  });

  test('the status bar findings item returns to the overview', async ({ page }) => {
    await open(page, 'train');
    await fileRow(page, 'session.ts').click();
    await page.locator('#statusbar [data-tab="overview"]').click();
    await expect(activeTab(page)).toHaveText('Overview');
  });

  test('unified and split layouts both render', async ({ page }) => {
    await open(page, 'train');
    await fileRow(page, 'session.ts').click();
    for (const style of ['split', 'unified']) {
      await page.locator(`[data-style="${style}"]`).click();
      await expect(page.locator(`[data-style="${style}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(diffLines(page).first()).toBeVisible();
    }
  });

  test('keyboard: arrows move the cursor, Enter opens, v marks viewed and survives a reload', async ({ page }) => {
    await open(page, 'train');
    await page.locator('#tree').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const opened = await page.locator('#tree .row.sel').getAttribute('data-key');
    expect(opened).toBeTruthy();
    await expect(page.locator('#diffmount')).toBeVisible();
    await page.locator('#tree').focus();
    await page.keyboard.press('v');
    await expect(page.locator(`#tree .file[data-key="${opened}"] input.viewed`)).toBeChecked();
    await expect(page.locator('#statusbar')).toContainText('1/4 viewed');
    await page.reload();
    await expect(page.locator(`#tree .file[data-key="${opened}"] input.viewed`)).toBeChecked();
  });

  test('tests and generated files start collapsed and expand on click', async ({ page }) => {
    await open(page, 'train');
    await expect(page.locator('#tree [data-group="tests"]')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#tree [data-group="tests"]').click();
    await expect(page.locator('#tree .file.t-tests')).toHaveCount(1);
    await expect(page.locator('#tree .file')).toHaveCount(4);
  });

  test('the layout fills the height with no gaps and a short header', async ({ page }) => {
    await open(page, 'train');
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const top = rect('.top');
      const body = rect('.body');
      const status = rect('#statusbar');
      return {
        headerHeight: Math.round(top.height),
        bodyTop: Math.round(body.top - top.bottom),
        bodyBottom: Math.round(status.top - body.bottom),
        below: Math.round(window.innerHeight - status.bottom),
      };
    });
    if (page.viewportSize().width >= 900) {
      expect(layout.headerHeight).toBeLessThanOrEqual(72);
      expect(layout).toMatchObject({ bodyTop: 0, bodyBottom: 0, below: 0 });
    }
  });

  test('nothing overflows horizontally', async ({ page }) => {
    await open(page, 'train');
    await fileRow(page, 'session.ts').click();
    await expect(diffLines(page).first()).toBeVisible();
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const editor = document.querySelector('.editor-body');
      return Math.max(root.scrollWidth - root.clientWidth, editor.scrollWidth - editor.clientWidth);
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('empty board', () => {
  test('a board with no changes says so and fills the height', async ({ page }) => {
    const errors = await open(page, 'empty');
    await expect(page.locator('.top h1')).toHaveText('Clean tree');
    await expect(page.locator('#chips')).toBeHidden();
    await expect(page.locator('.editor-body')).toContainText('Nothing to review');
    await expect(page.locator('#tree')).toContainText('No changed files.');
    const gaps = await page.evaluate(() => {
      const body = document.querySelector('.body').getBoundingClientRect();
      const status = document.querySelector('#statusbar').getBoundingClientRect();
      return { aboveStatus: Math.round(status.top - body.bottom), belowStatus: Math.round(window.innerHeight - status.bottom) };
    });
    if (page.viewportSize().width >= 900) expect(gaps).toEqual({ aboveStatus: 0, belowStatus: 0 });
    expect(errors).toEqual([]);
  });
});
