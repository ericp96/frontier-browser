import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { CdpBackend, type CdpTransport } from '../../src/backend/cdp-backend.js';

const here = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURES = join(here, '..', 'fixtures');

/** Chromium to test against: $CHROMIUM_PATH, the preinstalled one, or Playwright's default. */
export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  return undefined;
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--force-renderer-accessibility'] });
}

/** Serve test/fixtures over HTTP on a random port. */
export function serveFixtures(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, '');
      const file = join(FIXTURES, path === '/' ? 'index.html' : path);
      if (!file.startsWith(FIXTURES) || !existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/html' }).end('<title>Not found</title><h1>Not found</h1>');
        return;
      }
      const type = extname(file) === '.html' ? 'text/html; charset=utf-8' : 'text/plain';
      res.writeHead(200, { 'content-type': type }).end(readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

export async function cdpBackendFor(page: Page): Promise<CdpBackend> {
  const session = await page.context().newCDPSession(page);
  const backend = new CdpBackend(session as unknown as CdpTransport);
  await backend.init();
  return backend;
}
