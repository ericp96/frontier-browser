import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, test } from 'vitest';
import { installPageAgent } from '../src/page-agent/page-agent.js';
import { FIXTURES } from './helpers/chromium.js';

function agentFor(html: string, url = 'https://example.org/page') {
  const dom = new JSDOM(html, { url });
  return { dom, api: installPageAgent(dom.window as unknown as Window) };
}

describe('page agent digest', () => {
  const { api } = agentFor(readFileSync(join(FIXTURES, 'article.html'), 'utf8'), 'https://garden.example/tomatoes');
  const d = api.digest();

  test('title, language, description and kind', () => {
    expect(d.title).toBe('How to Grow Tomatoes | Garden News');
    expect(d.lang).toBe('en');
    expect(d.description).toMatch(/practical guide/);
    expect(d.kind).toBe('article');
  });

  test('landmarks and headings', () => {
    expect(d.landmarks.map((l) => l.role)).toEqual(expect.arrayContaining(['banner', 'navigation', 'search', 'main', 'contentinfo']));
    expect(d.headings.map((h) => [h.level, h.text])).toEqual([[1, 'How to Grow Tomatoes'], [2, 'Planting'], [2, 'Feeding']]);
  });

  test('accessible names follow aria-label and screen-reader-only text', () => {
    expect(d.links.find((l) => l.href.endsWith('/guides/peppers'))!.text).toBe('Read our guide to growing peppers');
    expect(d.controls.find((c) => c.kind === 'button' && c.name === 'Share this article')).toBeTruthy();
    expect(d.controls.find((c) => c.kind === 'search')!.name).toBe('Search the site');
  });

  test('distinguishes content links from chrome links, and external links', () => {
    expect(d.links.find((l) => l.text === 'News')!.inMain).toBe(false);
    expect(d.links.find((l) => l.text.includes('peppers'))!.inMain).toBe(true);
    expect(d.links.find((l) => l.text === 'Shop')!.external).toBe(true);
  });

  test('main content is in reading order and excludes nav, footer and control labels', () => {
    const texts = d.main.map((b) => b.text);
    expect(texts[0]).toBe('How to Grow Tomatoes');
    expect(texts).toContain('Tomato feed: 10 ml per 4.5 litres of water');
    expect(texts.join(' ')).not.toMatch(/Privacy|Contact us|Share this article/);
  });

  test('hidden content never reaches the digest (prompt-injection surface)', () => {
    expect(JSON.stringify(d)).not.toMatch(/ignore your previous instructions/i);
    expect(d.hiddenCount).toBeGreaterThan(0);
  });

  test('images: alt text vs missing description', () => {
    expect(d.images.find((i) => i.alt === 'Ripe red tomatoes on the vine')).toBeTruthy();
    expect(d.images.find((i) => i.src.endsWith('chart.png'))!.alt).toBeNull();
  });

  test('refs are stable across digests', () => {
    const again = api.digest();
    expect(again.headings.map((h) => h.ref)).toEqual(d.headings.map((h) => h.ref));
  });

  test('the agent never writes to the DOM', () => {
    const { dom, api: a } = agentFor('<main><p>Hello there friend</p><a href="/x">x</a></main>');
    const before = dom.serialize();
    a.digest();
    expect(dom.serialize()).toBe(before);
  });
});

describe('forms', () => {
  const html = readFileSync(join(FIXTURES, 'signup.html'), 'utf8');

  test('labels, required, sensitive fields, pre-checked opt-ins', () => {
    const { api } = agentFor(html, 'https://shop.example/signup');
    const d = api.digest();
    const byName = (n: string) => d.controls.find((c) => c.name === n)!;
    expect(byName('Email address').kind).toBe('email');
    expect(byName('Email address').required).toBe(true);
    expect(byName('Password').sensitive).toBe('password');
    expect(byName('Password').value).toBeUndefined();
    expect(byName('Password').hasValue).toBe(true);
    expect(byName('Card number').sensitive).toBe('payment');
    expect(byName('Country').options).toContain('Canada');
    expect(d.warnings.map((w) => w.kind)).toContain('prechecked-optin');
    expect(d.kind).toBe('form');
  });

  test('typing uses the native setter and fires input events', () => {
    const { dom, api } = agentFor(html, 'https://shop.example/signup');
    const d = api.digest();
    const email = d.controls.find((c) => c.kind === 'email')!;
    let inputs = 0;
    dom.window.document.querySelector('input[type=email]')!.addEventListener('input', () => inputs++);
    expect(api.act({ type: 'type', ref: email.ref, text: 'sam@example.org' }).ok).toBe(true);
    expect((dom.window.document.querySelector('input[type=email]') as HTMLInputElement).value).toBe('sam@example.org');
    expect(inputs).toBe(1);
  });

  test('select by spoken option text', () => {
    const { api } = agentFor(html, 'https://shop.example/signup');
    const country = api.digest().controls.find((c) => c.kind === 'select')!;
    const r = api.act({ type: 'select', ref: country.ref, option: 'canada' });
    expect(r).toEqual({ ok: true, value: 'Canada' });
  });

  test('stale refs are reported, not acted on', () => {
    const { dom, api } = agentFor(html, 'https://shop.example/signup');
    const email = api.digest().controls.find((c) => c.kind === 'email')!;
    dom.window.document.querySelector('input[type=email]')!.remove();
    expect(api.act({ type: 'click', ref: email.ref }).ok).toBe(false);
  });
});

describe('warnings', () => {
  test('tech-support scam text is flagged', () => {
    const { api } = agentFor(readFileSync(join(FIXTURES, 'scam.html'), 'utf8'), 'https://win-defender-alert.example/');
    expect(api.digest().warnings.map((w) => w.kind)).toContain('scam-suspected');
  });

  test('captcha and open modal dialogs', () => {
    const { api } = agentFor('<div class="g-recaptcha" data-sitekey="x"></div><dialog open aria-label="Cookie choices"><button>Accept</button></dialog>');
    const kinds = api.digest().warnings.map((w) => w.kind);
    expect(kinds).toEqual(expect.arrayContaining(['captcha', 'modal-open']));
  });

  test('passwords over http', () => {
    const { api } = agentFor('<input type="password" aria-label="Password">', 'http://bank.example/login');
    expect(api.digest().warnings.map((w) => w.kind)).toContain('insecure-password');
  });
});

describe('budgets', () => {
  test('huge pages are capped and marked truncated', () => {
    const links = Array.from({ length: 500 }, (_, i) => `<a href="/p${i}">Item number ${i}</a>`).join('');
    const { api } = agentFor(`<main>${links}</main>`);
    const d = api.digest({ maxLinks: 100 });
    expect(d.links).toHaveLength(100);
    expect(d.truncated).toBe(true);
  });
});
