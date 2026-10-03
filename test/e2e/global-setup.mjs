import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CDN_HAR, FIXTURES_JSON, recordCdn } from './cdn.mjs';
import { buildFixtures } from './fixtures.mjs';

export default async function globalSetup() {
  const { dir, pages } = buildFixtures();
  mkdirSync(dirname(FIXTURES_JSON), { recursive: true });
  writeFileSync(FIXTURES_JSON, JSON.stringify(pages));
  if (!process.env.LIVE_CDN && !existsSync(CDN_HAR)) await recordCdn(pages.train);
  return () => rmSync(dir, { recursive: true, force: true });
}
