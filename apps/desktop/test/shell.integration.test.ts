/**
 * The trusted shell UI, loaded in real Chromium with a stub bridge:
 * transcript semantics, live-region behaviour per profile, and an automated
 * WCAG 2.2 AA audit with axe-core.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launch } from '../../../packages/core/test/helpers/chromium.js';
import { cleanUserAgent } from '../src/ua.js';

const shellUrl = new URL('../shell/shell.html', import.meta.url).href;
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let browser: Browser;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => browser?.close());

async function openShell(profile: string): Promise<Page> {
  const page = await browser.newPage();
  await page.addInitScript((p) => {
    const listeners: Record<string, (...a: unknown[]) => void> = {};
    const w = window as unknown as Record<string, unknown>;
    w.__sent = [];
    w.__delivered = [];
    w.__emit = (name: string, ...args: unknown[]) => listeners[name]?.(...args);
    w.frontier = {
      command: async (t: string) => (w.__sent as string[]).push(t),
      audio: async () => null,
      getSettings: async () => ({ settings: { profile: p, verbosity: 'normal', autoRead: 'content' }, ai: null, speechToText: null, hasKey: { ai: false }, presets: {}, keyStorageProblem: null }),
      saveSettings: async () => ({ ok: true }),
      delivered: (id: number, r: string) => (w.__delivered as unknown[]).push([id, r]),
      onAnnounce: (cb: (...a: unknown[]) => void) => (listeners.announce = cb),
      onInterrupt: (cb: () => void) => (listeners.interrupt = cb),
      onRate: (cb: () => void) => (listeners.rate = cb),
      onFocusCommand: (cb: () => void) => (listeners.focus = cb),
    };
  }, profile);
  await page.goto(shellUrl);
  await page.waitForTimeout(50);
  return page;
}

test('transcript labels every message with its source, outside the page', async () => {
  const page = await openShell('screen-reader');
  await page.evaluate(() => {
    const emit = (window as unknown as { __emit: (...a: unknown[]) => void }).__emit;
    emit('announce', 1, { text: 'How to Grow Tomatoes.', kind: 'info', source: 'browser' });
    emit('announce', 2, { text: 'Tomatoes need sun.', kind: 'content', source: 'page', lang: 'en' });
    emit('announce', 3, { text: 'Feed weekly.', kind: 'info', source: 'ai' });
    emit('announce', 4, { text: 'Confirm: submit "Order".', kind: 'confirm', source: 'browser' });
  });
  const items = await page.locator('#log li').allTextContents();
  expect(items).toEqual(['Frontier:How to Grow Tomatoes.', 'Page:Tomatoes need sun.', 'AI:Feed weekly.', 'Frontier asks:Confirm: submit "Order".']);
  expect(await page.getAttribute('#log', 'aria-live')).toBe('polite');
  expect(await page.textContent('#alerts')).toBe('Frontier asks: Confirm: submit "Order".');
  // In screen-reader mode the screen reader speaks; delivery is acknowledged immediately.
  expect(await page.evaluate(() => (window as unknown as { __delivered: unknown[] }).__delivered.length)).toBe(4);
  await page.close();
});

test('voice profile silences the live region to avoid double speech', async () => {
  const page = await openShell('voice');
  expect(await page.getAttribute('#log', 'aria-live')).toBe('off');
  await page.close();
});

test('typing a command sends it', async () => {
  const page = await openShell('braille');
  await page.fill('#command', 'list headings');
  await page.press('#command', 'Enter');
  expect(await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent)).toEqual(['list headings']);
  expect(await page.locator('#log li.user').textContent()).toBe('You: list headings');
  await page.close();
});

test('WCAG 2.2 AA automated audit (axe-core) finds no violations', async () => {
  for (const scheme of ['dark', 'light'] as const) {
    const page = await openShell('screen-reader');
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => {
      const emit = (window as unknown as { __emit: (...a: unknown[]) => void }).__emit;
      emit('announce', 1, { text: 'Welcome to Frontier Browser.', kind: 'info', source: 'browser' });
      emit('announce', 2, { text: 'A warning.', kind: 'alert', source: 'browser' });
    });
    await page.evaluate(axeSource);
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } }).axe;
      const r = await axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return r.violations.map((v) => `${v.id} (${v.nodes.length})`);
    });
    expect(violations, `${scheme} scheme`).toEqual([]);
    // Settings dialog too.
    await page.click('#settings-button');
    await page.waitForTimeout(50);
    const dialogViolations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
      const r = await axe.run(document.getElementById('settings'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
      return r.violations.map((v) => v.id);
    });
    expect(dialogViolations, `${scheme} settings`).toEqual([]);
    await page.close();
  }
});

test('Electron is stripped from the user agent', () => {
  expect(cleanUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) @frontier/desktop/0.1.0 Chrome/140.0.0.0 Electron/43.7.5 Safari/537.36')).toBe(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  );
});

void fileURLToPath;
