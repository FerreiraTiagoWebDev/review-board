import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from '../skills/review-board/scripts/build.mjs';
import { createRepo, writeSidecar } from '../test/helpers/repo.mjs';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const lineOf = (content, needle) => content.split('\n').findIndex((line) => line.includes(needle)) + 1;

const STORE_BASE = `import { db } from '../db';

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<Session> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.sessions.insert({ id, userId, expiresAt });
  return { id, userId, expiresAt };
}

export async function findSession(id: string): Promise<Session | null> {
  const session = await db.sessions.get(id);
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}
`;

const STORE_TTL = `import { db } from '../db';
import { SESSION_TTL_SECONDS } from './config';

export interface Session {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(userId: string, ttlSeconds = SESSION_TTL_SECONDS) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.sessions.insert({ id, userId, expiresAt });
  return { id, userId, expiresAt };
}

export async function findSession(id: string): Promise<Session | null> {
  const session = await db.sessions.get(id);
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function refreshSession(session: Session, ttlSeconds = SESSION_TTL_SECONDS) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.sessions.update(session.id, { expiresAt });
  return { ...session, expiresAt };
}
`;

const ROUTES_BASE = `import { Router } from 'express';
import { verifyPassword } from '../auth/password';
import { createSession } from '../session/store';

export const sessions = Router();

sessions.post('/sessions', async (req, res) => {
  const user = await verifyPassword(req.body);
  if (!user) return res.status(401).end();
  const session = await createSession(user.id);
  res.cookie('sid', session.id, { httpOnly: true });
  res.status(201).json({ expiresAt: session.expiresAt });
});
`;

const ROUTES_TTL = `import { Router } from 'express';
import { verifyPassword } from '../auth/password';
import { createSession } from '../session/store';

const DAY_MS = 24 * 60 * 60 * 1000;

export const sessions = Router();

sessions.post('/sessions', async (req, res) => {
  const user = await verifyPassword(req.body);
  if (!user) return res.status(401).end();
  const ttl = req.body.rememberMe ? 30 * DAY_MS : undefined;
  const session = await createSession(user.id, ttl);
  res.cookie('sid', session.id, { httpOnly: true });
  res.status(201).json({ expiresAt: session.expiresAt });
});
`;

const GUARD_BASE = `import type { RequestHandler } from 'express';
import { findSession } from '../session/store';

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await findSession(req.cookies.sid);
  if (!session) return res.status(401).end();
  res.locals.session = session;
  next();
};
`;

const GUARD_TTL = `import type { RequestHandler } from 'express';
import { findSession, refreshSession } from '../session/store';

export const requireSession: RequestHandler = async (req, res, next) => {
  const session = await findSession(req.cookies.sid);
  if (!session) return res.status(401).end();
  res.locals.session = await refreshSession(session);
  next();
};
`;

function buildDemo(dir) {
  const repo = createRepo(dir);
  repo.write('src/session/store.ts', STORE_BASE);
  repo.write('src/api/sessions.ts', ROUTES_BASE);
  repo.write('src/auth/guard.ts', GUARD_BASE);
  repo.write('src/util/format.ts', `export const formatDate = (date: Date) => date.toISOString().slice(0, 10);\n`);
  const base = repo.commit('base');

  repo.git('checkout', '--quiet', '-b', 'feat/session-ttl');
  repo.write('src/session/config.ts', `export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL ?? 86_400);\n`);
  repo.write('src/session/store.ts', STORE_TTL);
  repo.write('src/api/sessions.ts', ROUTES_TTL);
  repo.write('src/auth/guard.ts', GUARD_TTL);
  repo.write(
    'src/session/store.test.ts',
    `import { expect, test } from 'vitest';\nimport { createSession } from './store';\n\ntest('a session expires after the ttl', async () => {\n  const session = await createSession('u1', 60);\n  expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);\n});\n`,
  );
  repo.commit('feat: configurable session ttl, refreshed on every request');

  repo.git('checkout', '--quiet', '-b', 'fix/date-format', base);
  repo.write('src/util/format.ts', `export const formatDate = (date: Date, locale = 'en-GB') => date.toLocaleDateString(locale);\n`);
  repo.commit('fix: format dates in the reader locale');

  repo.git('checkout', '--quiet', '-b', 'chore/merge-train', base);
  repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #41 feat/session-ttl into merge train', 'feat/session-ttl');
  repo.git('merge', '--quiet', '--no-ff', '-m', 'merge: #42 fix/date-format into merge train', 'fix/date-format');

  const sidecar = writeSidecar(repo, {
    slug: 'train',
    title: 'Merge train → main',
    lead: 'Two PRs merged locally on chore/merge-train; nothing pushed.',
    mode: 'train',
    depth: 'full',
    train: { base, head: 'chore/merge-train' },
    curation: {
      sets: {
        41: {
          title: 'Configurable session ttl',
          summary: 'Sessions now last `SESSION_TTL` seconds (default one day) and every authenticated request pushes the expiry forward.',
          files: {
            'src/session/config.ts': { tier: 'core', note: 'Where the ttl comes from, in seconds.' },
            'src/session/store.ts': { tier: 'core', note: 'createSession takes the ttl; refreshSession extends it.' },
            'src/auth/guard.ts': { tier: 'core', note: 'Refreshes the session on every request.' },
            'src/api/sessions.ts': { tier: 'core', note: 'Login passes a longer ttl for "remember me".' },
          },
          findings: [
            {
              severity: 'high',
              verdict: 'CONFIRMED',
              file: 'src/api/sessions.ts',
              line: lineOf(ROUTES_TTL, 'const ttl ='),
              text: '"Remember me" passes 30 * DAY_MS, milliseconds, where createSession now takes seconds, so the session lasts 82 years instead of 30 days. Repro: log in with rememberMe and read expiresAt. Fix: pass 30 * 86_400.',
            },
            {
              severity: 'low',
              verdict: 'PLAUSIBLE',
              file: 'src/auth/guard.ts',
              line: lineOf(GUARD_TTL, 'refreshSession(session)'),
              text: 'Every request refreshes with the default ttl, so a 30-day session shrinks to one day on its first request.',
            },
          ],
        },
        42: { title: 'Dates in the reader locale', summary: 'formatDate renders in the reader locale instead of ISO.' },
      },
      verification: {
        lead: 'Measured on the train head.',
        rows: [
          { check: 'pnpm typecheck', result: 'pass' },
          { check: 'pnpm test', result: 'pass' },
          { check: 'pnpm lint', result: '1 fail, pre-existing on main: unused import in src/legacy/report.ts' },
        ],
      },
      decisions: [{ id: 'D1', title: 'Push the train and open one PR to main', options: ['Fix 41-F1 first, then push', 'Push and open the PR now'] }],
    },
  });
  return build(sidecar).out;
}

const dir = mkdtempSync(join(tmpdir(), 'review-board-demo-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 760 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  await page.goto(`file://${buildDemo(dir)}`);
  await page.locator('.editor-body .ov-set').first().waitFor();
  await page.screenshot({ path: join(DOCS, 'overview.png') });
  await page.setViewportSize({ width: 1400, height: 720 });
  await page.locator('.editor-body [data-finding-id="41-F1"]').click();
  await page.locator('#diffmount [data-finding="41-F1"]').waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(DOCS, 'diff.png') });
  console.log(`wrote ${join(DOCS, 'overview.png')} and ${join(DOCS, 'diff.png')}`);
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}
