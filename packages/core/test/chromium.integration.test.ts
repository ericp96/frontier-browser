/**
 * Integration tests on real Chromium via CDP — the same backend code the
 * Electron shell uses.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { cdpBackendFor, launch, serveFixtures } from './helpers/chromium.js';
import { Assistant } from '../src/assistant/assistant.js';
import { RecordingOutput } from '../src/speech/output.js';
import type { CdpBackend } from '../src/backend/cdp-backend.js';

let browser: Browser;
let base: string;
let stop: () => void;

beforeAll(async () => {
  browser = await launch();
  const s = await serveFixtures();
  base = s.base;
  stop = () => s.server.close();
});
afterAll(async () => {
  await browser?.close();
  stop?.();
});

async function open(path: string): Promise<{ page: Page; backend: CdpBackend }> {
  const page = await browser.newPage();
  const backend = await cdpBackendFor(page);
  await backend.navigate(base + path);
  return { page, backend };
}

describe('isolation (AR-5)', () => {
  test('the page cannot see the agent, and cannot lie to it', async () => {
    const { page, backend } = await open('/isolation.html');
    const d = await backend.digest();
    await page.waitForTimeout(50);
    // Not visible to page scripts.
    expect(await page.evaluate(() => typeof (window as unknown as { __frontier?: unknown }).__frontier)).toBe('undefined');
    expect(await page.evaluate(() => (window as unknown as { __detected: string[] }).__detected.length)).toBe(0);
    // The page patched getAttribute and getComputedStyle in its own world; the agent is unaffected.
    expect(d.headings.map((h) => h.text)).toEqual(['Real heading']);
    expect(d.controls[0]!.name).toBe('Real button');
    expect(d.main.map((b) => b.text)).toContain('Real paragraph of content for the reader.');
    // No attributes written to the DOM.
    expect(await page.evaluate(() => document.querySelectorAll('[data-frontier-ref]').length)).toBe(0);
    await page.close();
  });
});

describe('accessibility tree agreement (AR-6)', () => {
  test('names match what a screen reader is told', async () => {
    const { page, backend } = await open('/article.html');
    const d = await backend.digest();
    expect(backend.lastReconciliation.checked).toBeGreaterThanOrEqual(10);
    expect(backend.lastReconciliation.disagreements).toEqual([]);
    expect(d.links.find((l) => l.href.endsWith('/guides/peppers'))!.text).toBe('Read our guide to growing peppers');
    await page.close();
  });

  test('when our name differs from Chromium, Chromium wins', async () => {
    const page = await browser.newPage();
    const backend = await cdpBackendFor(page);
    // aria-labelledby pointing at a hidden element with display:none text is a
    // classic edge case; Chromium includes hidden labelledby targets.
    await page.setContent('<main><span id="lbl" hidden>Hidden label text</span><button aria-labelledby="lbl">Visible</button><input title="Title name"></main>');
    const d = await backend.digest();
    expect(d.controls[0]!.name).toBe('Hidden label text');
    expect(d.controls[1]!.name).toBe('Title name');
    await page.close();
  });
});

describe('trusted input (AR-20)', () => {
  test('clicks are real input events and typing is real text insertion', async () => {
    const page = await browser.newPage();
    const backend = await cdpBackendFor(page);
    await page.setContent(`<main><label>Name <input id="n"></label><button id="b">Go</button><p id="out"></p></main>
      <script>
        document.getElementById('b').addEventListener('click', e => { document.getElementById('out').textContent = 'trusted=' + e.isTrusted; });
        document.getElementById('n').addEventListener('input', e => { window.lastInputTrusted = e.isTrusted; });
      </script>`);
    const d = await backend.digest();
    const input = d.controls.find((c) => c.name === 'Name')!;
    const button = d.controls.find((c) => c.name === 'Go')!;
    expect((await backend.act({ type: 'type', ref: input.ref, text: 'Ada Lovelace' })).ok).toBe(true);
    expect(await page.inputValue('#n')).toBe('Ada Lovelace');
    expect(await page.evaluate(() => (window as unknown as { lastInputTrusted: boolean }).lastInputTrusted)).toBe(true);
    await backend.act({ type: 'click', ref: button.ref });
    expect(await page.textContent('#out')).toBe('trusted=true');
    await page.close();
  });

  test('a covered element falls back safely instead of clicking the overlay', async () => {
    const page = await browser.newPage();
    const backend = await cdpBackendFor(page);
    await page.setContent(`<button id="b">Under</button><div style="position:fixed;inset:0;background:#fff"></div><p id="o"></p>
      <script>document.getElementById('b').onclick = () => document.getElementById('o').textContent = 'clicked';</script>`);
    const d = await backend.digest();
    await backend.act({ type: 'click', ref: d.controls[0]!.ref });
    expect(await page.textContent('#o')).toBe('clicked');
    await page.close();
  });
});

describe('dialogs and unload traps (AR-11)', () => {
  test('alerts are dismissed and announced; beforeunload cannot trap the user', async () => {
    const page = await browser.newPage();
    const backend = await cdpBackendFor(page);
    const output = new RecordingOutput();
    const assistant = new Assistant({ backend, output });
    await backend.navigate(base + '/article.html');
    await page.evaluate(() => {
      window.addEventListener('beforeunload', (e) => {
        e.preventDefault();
        e.returnValue = 'Your computer is at risk, do not leave';
      });
      setTimeout(() => alert('You have won a prize!'), 0);
    });
    await page.waitForTimeout(200);
    expect(output.texts().join(' ')).toMatch(/The page showed a message: "You have won a prize!"/);
    await assistant.handle('get me out');
    expect(backend.currentUrl()).toBe('about:blank');
    assistant.dispose();
    await page.close();
  });
});

describe('end to end on Chromium', () => {
  test('open, hear content first, skim, fill and submit with confirmation', async () => {
    const page = await browser.newPage();
    const backend = await cdpBackendFor(page);
    const output = new RecordingOutput();
    const assistant = new Assistant({ backend, output, random: () => 0.06 });
    await assistant.handle(`go to ${base}/article.html`);
    await page.waitForTimeout(100);
    const spoken = output.texts().join('\n');
    expect(spoken).toMatch(/How to Grow Tomatoes \| Garden News\. Article/);
    expect(spoken).toMatch(/Tomatoes need at least six hours/);

    await assistant.handle('list headings');
    expect(output.texts().join('\n')).toMatch(/3 headings\.[\s\S]*1: level 1, How to Grow Tomatoes\. 2: level 2, Planting\. 3: level 2, Feeding\./);

    await assistant.handle(`go to ${base}/signup.html`);
    await page.waitForTimeout(100);
    await assistant.handle('fill email with ada at example dot org');
    await assistant.handle('my full name is Ada Lovelace');
    expect(await page.inputValue('#email')).toBe('ada@example.org');
    const submitting = assistant.handle('submit');
    await page.waitForTimeout(100);
    const confirm = output.last()!;
    expect(confirm.kind).toBe('confirm');
    expect(confirm.text).toMatch(/127\.0\.0\.1/);
    const word = /confirm (\w+)"/.exec(confirm.text)![1]!;
    await assistant.handle(`confirm ${word}`);
    await submitting;
    await page.waitForTimeout(100);
    expect(await page.textContent('#status')).toBe('Account created for ada@example.org');
    assistant.dispose();
    await page.close();
  });
});
