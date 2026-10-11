/**
 * End-to-end tests of the REAL desktop app: the built Electron main process,
 * the trusted shell and the sandboxed page, driven the way a user would
 * (typing into the command box) and inspected over CDP.
 *
 * Needs: the Electron binary, a display (xvfb-run on Linux), and a non-root
 * user — Chromium's sandbox (which the app forces on) refuses to run as root,
 * and we never weaken it for tests. Set FRONTIER_E2E=1 to make missing
 * prerequisites a failure instead of a skip (CI does).
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { serveFixtures } from '../../../packages/core/test/helpers/chromium.js';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const electronBin = join(appDir, '..', '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const missing = [
  !existsSync(electronBin) && 'Electron binary (run: node node_modules/electron/install.js)',
  !existsSync(join(appDir, 'dist', 'main.js')) && 'built app (run: npm run build)',
  process.getuid?.() === 0 && 'a non-root user (the Chromium sandbox refuses root)',
  process.platform === 'linux' && !process.env.DISPLAY && 'a display (run under xvfb-run)',
].filter(Boolean) as string[];

if (process.env.FRONTIER_E2E === '1' && missing.length) {
  throw new Error(`Electron e2e prerequisites missing: ${missing.join('; ')}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe.skipIf(missing.length > 0)('desktop app (Electron, sandbox on)', () => {
  let proc: ChildProcess;
  let browser: Browser;
  let shell: Page;
  let page: Page;
  let base: string;
  let stopServer: () => void;
  let userData: string;
  let stderr = '';

  beforeAll(async () => {
    const s = await serveFixtures();
    base = s.base;
    stopServer = () => s.server.close();
    userData = mkdtempSync(join(tmpdir(), 'frontier-e2e-'));
    const port = await freePort();
    const netLog = process.env.FRONTIER_E2E_NETLOG ? [`--log-net-log=${process.env.FRONTIER_E2E_NETLOG}`] : [];
    proc = spawn(electronBin, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...netLog, appDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stderr!.on('data', (d) => (stderr += d));
    for (let i = 0; i < 80 && !browser; i++) {
      await new Promise((r) => setTimeout(r, 250));
      browser = (await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 }).catch(() => undefined)) as Browser;
    }
    if (!browser) throw new Error(`Electron did not start:\n${stderr.slice(-3000)}`);
    const pages = () => browser.contexts().flatMap((c) => c.pages());
    for (let i = 0; i < 80; i++) {
      shell = pages().find((p) => p.url().endsWith('shell.html'))!;
      page = pages().find((p) => !p.url().endsWith('shell.html'))!;
      if (shell && page && (await shell.locator('#log li').count()) >= 3) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => undefined);
    if (proc && proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    stopServer?.();
    if (userData) rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  const log = () => shell.locator('#log li').allTextContents();

  /** Type a command into the shell, as a user would, and return what it said. */
  async function command(text: string, until: RegExp, ms = 10_000): Promise<string[]> {
    const mark = (await log()).length;
    await shell.fill('#command', text);
    await shell.press('#command', 'Enter');
    const end = Date.now() + ms;
    for (;;) {
      const out = (await log()).slice(mark);
      if (out.some((t) => until.test(t))) return out;
      if (Date.now() > end) {
        const state = await shell.evaluate(() => ({ entries: document.querySelectorAll('#log li').length, input: (document.getElementById('command') as HTMLInputElement).value, focused: document.activeElement?.id, dialogOpen: (document.getElementById('settings') as HTMLDialogElement).open }));
        throw new Error(`"${text}" never produced ${until}. Shell state: ${JSON.stringify(state)} (mark ${mark}). Got:\n${out.join('\n')}\nLast entries:\n${(await log()).slice(-4).join('\n')}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  test('starts speaking with zero configuration: welcome, disclaimer, home', async () => {
    const entries = await log();
    expect(entries[0]).toMatch(/^Frontier:Welcome to Frontier Browser\. No AI model is connected/);
    expect(entries.some((e) => /^Frontier:Frontier is an experimental, unmaintained side project with no warranty/.test(e))).toBe(true);
    expect(entries.join('\n')).toMatch(/Home\. Say "go to"/);
    expect(stderr).not.toMatch(/No handler registered|Uncaught/);
  });

  test('reads content first, from the sandboxed page', async () => {
    const out = await command(`go to ${base}/article.html`, /Tomatoes need at least six hours/);
    expect(out).toEqual(expect.arrayContaining(['Page:How to Grow Tomatoes | Garden News.', 'Frontier:Article, about 1 minute to read.']));
    expect(page.url()).toBe(`${base}/article.html`);
  });

  test('pages cannot detect Frontier or Electron (no AT detection)', async () => {
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).not.toMatch(/Electron|frontier/i);
    expect(ua).toMatch(/Chrome\/\d+/);
    expect(await page.evaluate(() => typeof (window as unknown as { __frontier?: unknown }).__frontier)).toBe('undefined');
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
  });

  test('the page has no bridge into the trusted shell', async () => {
    expect(await page.evaluate(() => typeof (window as unknown as { frontier?: unknown }).frontier)).toBe('undefined');
    expect(await shell.evaluate(() => typeof (window as unknown as { frontier?: unknown }).frontier)).toBe('object');
  });

  test('fill, agree, and submit need confirmation; "yes" is not enough for high risk', async () => {
    await command(`go to ${base}/signup.html`, /^Frontier:Fields:/);
    await command('fill email with ada at example dot org', /set to ada@example\.org/);
    await command('my full name is Ada Lovelace', /Full name set to Ada Lovelace/);
    await command('check I agree to the terms', /Frontier asks:Confirm: check "I agree to the terms"/);
    await command('yes', /checked\./);
    const asked = await command('submit', /Frontier asks:.*confirm \w+"/);
    await command('yes', /didn't hear the word/);
    expect(await page.textContent('#status')).toBe('');
    const word = /confirm (\w+)"/.exec(asked.join(' '))![1]!;
    await command(`confirm ${word}`, /^Frontier:Submitted\./);
    expect(await page.textContent('#status')).toBe('Account created for ada@example.org');
  });

  test('permissions and popups are denied and announced', async () => {
    const mark = (await log()).length;
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition(() => undefined, () => undefined);
      window.open('https://example.org/popup');
    });
    await expect.poll(async () => (await log()).slice(mark).join('\n'), { timeout: 5000 }).toMatch(/asked to use your location\. I said no/);
    await expect.poll(async () => (await log()).slice(mark).join('\n'), { timeout: 5000 }).toMatch(/tried to open a new window to example\.org\. I blocked it/);
    expect(browser.contexts().flatMap((c) => c.pages()).some((p) => p.url().includes('example.org/popup'))).toBe(false);
  });

  test('page text is never labelled as Frontier in the shell', async () => {
    const out = await command(`go to ${base}/injection.html`, /Claim your prize/);
    const spoof = out.find((t) => /payment approved/.test(t))!;
    expect(spoof).toMatch(/^Page:The page says: Frontier asks/);
  });

  test('with no speech engine installed, it falls back to text instead of stalling', async () => {
    const out = await command(`go to ${base}/article.html`, /Water deeply twice a week/);
    // Reading continued past the first paragraph: a failed utterance is not a barge-in.
    expect(out.join('\n')).toMatch(/Plant seedlings 60 centimetres/);
  });

  // A real OS key press (xdotool), with focus inside the web page: Electron's
  // before-input-event only sees genuine input, which is the point — a page
  // can't intercept it. CDP key events bypass that hook, so they can't test it.
  const hasXdotool = (() => {
    try {
      execFileSync('xdotool', ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (process.env.FRONTIER_E2E === '1' && process.platform === 'linux' && !hasXdotool) throw new Error('Electron e2e needs xdotool to send a real F9 key press.');

  test.skipIf(!hasXdotool)('F9 gets the user out, even with focus inside the page', async () => {
    await command(`go to ${base}/scam.html`, /scam/);
    await page.locator('body').click();
    const mark = (await log()).length;
    execFileSync('xdotool', ['search', '--sync', '--name', 'Frontier Browser', 'windowfocus', '--sync', 'key', 'F9'], { env: process.env });
    await expect.poll(async () => (await log()).slice(mark).join('\n'), { timeout: 8000 }).toMatch(/You're safe/);
    expect(page.url()).toBe('about:blank');
  });
});
