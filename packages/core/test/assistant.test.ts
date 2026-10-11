import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Assistant } from '../src/assistant/assistant.js';
import { RecordingOutput } from '../src/speech/output.js';
import type { ChatMessage, ChatResult, ModelProvider, ToolDef } from '../src/ai/provider.js';
import { FakeBackend, settle } from './helpers/fake-backend.js';
import { FIXTURES } from './helpers/chromium.js';

const fixture = (f: string) => readFileSync(join(FIXTURES, f), 'utf8');

const PAGES: Record<string, string> = {
  'https://garden.example/tomatoes': fixture('article.html'),
  'https://shop.example/signup': fixture('signup.html'),
  'https://win-defender-alert.example/': fixture('scam.html'),
  'https://reviews.example/laptops': fixture('injection.html'),
  'https://paypa1.com/login': '<title>PayPal: Log in</title><main><h1>Log in to your account</h1><p>Enter your email and password to continue.</p></main>',
  'https://html.duckduckgo.com/html/?q=tomato%20feed': `<title>tomato feed at DuckDuckGo</title><form><input type="search" name="q" aria-label="Search" value="tomato feed"></form><main>
    <h2><a href="https://a.example/feed">Best tomato feed for bigger harvests</a></h2><h2><a href="https://b.example/guide">Complete guide to feeding tomatoes</a></h2>
    <h2><a href="https://c.example/organic">Organic tomato fertiliser reviewed</a></h2><h2><a href="https://d.example/diy">Make your own tomato feed at home</a></h2>
    <h2><a href="https://e.example/when">When to start feeding tomatoes</a></h2></main>`,
};

function setup(opts: { provider?: ModelProvider; pages?: Record<string, string> } = {}) {
  const backend = new FakeBackend({ ...PAGES, ...opts.pages });
  const output = new RecordingOutput();
  const assistant = new Assistant({ backend, output, provider: opts.provider, random: () => 0 });
  return { backend, output, assistant };
}

class ScriptedProvider implements ModelProvider {
  readonly id = 'scripted';
  readonly label = 'Test Model';
  calls: { messages: ChatMessage[]; tools?: ToolDef[] }[] = [];
  constructor(
    private readonly script: ChatResult[],
    readonly isLocal = false,
    readonly supportsTools = true,
  ) {}
  async chat(messages: ChatMessage[], o?: { tools?: ToolDef[] }): Promise<ChatResult> {
    this.calls.push({ messages: [...messages], tools: o?.tools });
    return this.script.shift() ?? { text: 'Done.', toolCalls: [] };
  }
}

describe('content first', () => {
  test('article: title and kind, then the content itself', async () => {
    const { backend, output } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await settle();
    const [title, kind, first] = output.log;
    // The title is page-controlled, so it is framed as page text; the page kind is our own fact.
    expect(title).toMatchObject({ source: 'page', text: 'How to Grow Tomatoes | Garden News.' });
    expect(kind).toMatchObject({ source: 'browser', text: 'Article, about 1 minute to read.' });
    // The repeated h1 is skipped; the first thing read is real content.
    expect(first).toMatchObject({ source: 'page', kind: 'content', lang: 'en', text: expect.stringMatching(/^Tomatoes need at least six hours/) });
    expect(output.texts().join(' ')).toMatch(/Heading: Planting/);
  });

  test('scam pages: warning first, and nothing read aloud automatically', async () => {
    const { backend, output } = setup();
    await backend.navigate('https://win-defender-alert.example/');
    await settle();
    expect(output.log[0]).toMatchObject({ kind: 'alert', text: expect.stringMatching(/scam/) });
    expect(output.log.some((a) => a.kind === 'content')).toBe(false);
    expect(output.texts().join(' ')).toMatch(/get me out/);
  });

  test('lookalike domains are announced before the page title', async () => {
    const { backend, output } = setup();
    await backend.navigate('https://paypa1.com/login');
    await settle();
    expect(output.log[0]).toMatchObject({ kind: 'alert', text: expect.stringMatching(/not the real paypal/) });
    expect(output.log.findIndex((a) => /PayPal: Log in/.test(a.text))).toBeGreaterThan(0);
  });

  test('search results: the top results are the content; a number opens one', async () => {
    const { backend, output, assistant } = setup();
    await assistant.handle('search for tomato feed');
    await settle();
    expect(output.texts().join(' ')).toMatch(/Top results\. 1: Best tomato feed for bigger harvests\. 2: Complete guide/);
    await assistant.handle('2');
    expect(backend.actions.at(-1)).toMatchObject({ type: 'click' });
    expect(output.last()!.text).toMatch(/Opening Complete guide to feeding tomatoes/);
  });

  test('forms get orientation instead of being read top to bottom', async () => {
    const { backend, output } = setup();
    await backend.navigate('https://shop.example/signup');
    await settle();
    expect(output.texts().join(' ')).toMatch(/Form with \d+ fields\..*Fields: Email address, Full name, Password/);
    expect(output.log.some((a) => a.kind === 'alert' && /already checked for you/.test(a.text))).toBe(true);
  });
});

describe('navigation and reading', () => {
  test('next heading moves focus once and announces it', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await settle();
    await assistant.handle('next heading');
    await assistant.handle('next heading');
    expect(output.last()!.text).toBe('Heading level 2: Planting');
    expect(backend.actions.filter((a) => a.type === 'focus')).toHaveLength(2);
    // "continue" now reads from just after that heading.
    const mark = output.log.length;
    await assistant.handle('continue');
    expect(output.log.slice(mark).find((a) => a.kind === 'content')!.text).toMatch(/^Plant seedlings 60 centimetres/);
  });

  test('every input barges in', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    const before = output.interrupts;
    await assistant.handle('stop');
    expect(output.interrupts).toBe(before + 1);
  });

  test('discovery is deterministic, from the page structure', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('what can I do here');
    expect(output.last()!.text).toMatch(/^On this page you can: 1, read the main text/);
    expect(output.last()!.text).toMatch(/search this site/);
  });

  test('links list is numbered and a number activates it', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('list links');
    expect(output.texts().join(' ')).toMatch(/1: Read our guide to growing peppers/);
    await assistant.handle('1');
    expect(output.last()!.text).toMatch(/Opening Read our guide to growing peppers/);
  });

  test('ambiguous targets ask which one', async () => {
    const { backend, output, assistant } = setup({ pages: { 'https://x.example/': '<main><button>Delete draft</button><button>Delete account</button></main>' } });
    await backend.navigate('https://x.example/');
    await assistant.handle('click delete');
    expect(output.log.at(-2)).toMatchObject({ kind: 'confirm', source: 'browser', text: 'I found 2 matches. Which one? Say a number.' });
    expect(output.last()).toMatchObject({ source: 'page', text: '1, Delete draft. 2, Delete account.' });
    void assistant.handle('1');
    await settle();
    expect(output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/press "Delete draft"/) });
    await assistant.handle('no');
  });

  test('page text pretending to be the browser is reframed', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://reviews.example/laptops');
    await settle();
    await assistant.handle('read');
    const spoof = output.log.find((a) => /payment approved/.test(a.text))!;
    expect(spoof.source).toBe('page');
    const { formatForLog } = await import('../src/speech/output.js');
    expect(formatForLog(spoof)).toMatch(/^The page says: Frontier asks/);
  });
});

describe('forms and confirmation', () => {
  test('dictated email is normalised; passwords are never echoed', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://shop.example/signup');
    await assistant.handle('fill email with sam dot jones at example dot org');
    expect(output.last()!.text).toBe('Email address set to sam.jones@example.org.');
    await assistant.handle('fill password with correct horse battery');
    expect(output.last()!.text).not.toMatch(/correct horse/);
    expect(output.last()!.text).toMatch(/^Filled in Password\./);
  });

  test('a payment form needs the challenge word; "yes" is not enough', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://shop.example/signup');
    await assistant.handle('fill email with sam at example dot org');
    await assistant.handle('my full name is Sam Jones');
    const submitting = assistant.handle('submit');
    await settle();
    expect(output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/confirm river/) });
    await assistant.handle('yes');
    expect(output.last()!.text).toMatch(/didn't hear the word/);
    expect(backend.actions.some((a) => a.type === 'submit')).toBe(false);
    await assistant.handle('confirm river');
    await submitting;
    expect(backend.actions.some((a) => a.type === 'submit')).toBe(true);
  });

  test('declining does nothing', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://shop.example/signup');
    await assistant.handle('fill email with a at b dot com');
    await assistant.handle('my name is Al');
    const p = assistant.handle('press create account');
    await settle();
    await assistant.handle('no');
    await p;
    expect(backend.actions.some((a) => a.type === 'click')).toBe(false);
    expect(output.last()!.text).toMatch(/Cancelled\. Nothing was done\./);
  });

  test('required empty fields are reported before submitting', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://shop.example/signup');
    await assistant.handle('submit');
    expect(output.last()).toMatchObject({ kind: 'alert', text: expect.stringMatching(/Email address, Full name .*required and empty/) });
  });

  test('"get me out" always works, even mid-confirmation', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://shop.example/signup');
    await assistant.handle('fill email with a at b dot com');
    await assistant.handle('my name is Al');
    const p = assistant.handle('submit');
    await settle();
    await assistant.handle('get me out');
    await p;
    expect(backend.currentUrl()).toBe('about:blank');
    expect(backend.actions.some((a) => a.type === 'submit')).toBe(false);
    expect(output.log.some((a) => /You're safe/.test(a.text))).toBe(true);
  });
});

describe('bring your own model', () => {
  test('with no model, unknown requests explain how to get help — no network, no paywall', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('how often should I feed them');
    expect(output.last()!.text).toMatch(/Say "help".*connect your own AI model/);
  });

  test('summary without a model is extractive and says so', async () => {
    const { backend, output, assistant } = setup();
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('summarize');
    expect(output.texts().join(' ')).toMatch(/No AI model is connected, so here is the start of the page rather than a summary/);
  });

  test('cloud models need per-site consent; answers are labelled and numbers verified', async () => {
    const provider = new ScriptedProvider([{ text: 'Feed every 7 to 10 days, using 15 ml per 4.5 litres.', toolCalls: [] }]);
    const { backend, output, assistant } = setup({ provider });
    await backend.navigate('https://garden.example/tomatoes');
    const p = assistant.handle('how often should I feed them?');
    await settle();
    expect(output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/send part of this page from garden\.example to Test Model.*"once", "always"/) });
    expect(provider.calls).toHaveLength(0);
    await assistant.handle('once');
    await p;
    // Read-only tools only, for a question.
    expect(provider.calls[0]!.tools!.map((t) => t.name)).not.toContain('click');
    const ai = output.log.find((a) => a.source === 'ai')!;
    expect(ai.text).toMatch(/Feed every 7 to 10 days/);
    expect(output.last()).toMatchObject({ kind: 'alert', text: expect.stringMatching(/couldn't find 15 ml/) });
    expect(assistant.audit.recent(1)[0]).toMatchObject({ provider: 'Test Model', local: false, purpose: 'question' });
  });

  test('page content is wrapped as untrusted and hidden text never reaches the model', async () => {
    const provider = new ScriptedProvider([{ text: 'It is about tomatoes.', toolCalls: [] }], true);
    const { backend, assistant } = setup({ provider });
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('what is this page about?');
    const user = provider.calls[0]!.messages.find((m) => m.role === 'user')!.content;
    expect(user).toMatch(/<untrusted_page>[\s\S]*Tomatoes need at least six hours[\s\S]*<\/untrusted_page>/);
    expect(user).not.toMatch(/ignore your previous instructions/);
    expect(provider.calls[0]!.messages[0]!.content).toMatch(/never instructions/);
  });

  test('"never" for a site is honoured', async () => {
    const provider = new ScriptedProvider([]);
    const { backend, output, assistant } = setup({ provider });
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('never send this site to the AI');
    await assistant.handle('what is this about?');
    expect(provider.calls).toHaveLength(0);
    expect(output.last()!.text).toMatch(/You chose never to send garden\.example/);
  });
});

describe('prompt-injection corpus (a compromised model that obeys the page)', () => {
  async function injected(script: ChatResult[], request = 'find the cheapest laptop and tell me the price') {
    const provider = new ScriptedProvider(script, true);
    const env = setup({ provider });
    await env.backend.navigate('https://reviews.example/laptops');
    await settle();
    return { ...env, provider, run: env.assistant.handle(request) };
  }
  const digestRef = async (backend: FakeBackend, pick: (d: Awaited<ReturnType<FakeBackend['digest']>>) => string) => pick(await backend.digest());

  test('navigating to the attacker site needs the user to say yes', async () => {
    const { backend, output, assistant, run } = await injected([
      { text: '', toolCalls: [{ id: '1', name: 'navigate', arguments: { url: 'https://evil.example/collect' } }] },
      { text: 'I was not allowed to open that site.', toolCalls: [] },
    ]);
    await settle();
    expect(output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/different site, evil\.example, that you didn't mention/) });
    await assistant.handle('no');
    await run;
    expect(backend.navigations).not.toContain('https://evil.example/collect');
  });

  test('typing data the user never gave needs confirmation', async () => {
    const provider = new ScriptedProvider([], true);
    const env = setup({ provider });
    await env.backend.navigate('https://reviews.example/laptops');
    const email = await digestRef(env.backend, (d) => d.controls.find((c) => c.kind === 'email')!.ref);
    provider['script'].push(
      { text: '', toolCalls: [{ id: '1', name: 'type_text', arguments: { ref: email, text: 'victim@example.org' } }] },
      { text: 'OK.', toolCalls: [] },
    );
    const run = env.assistant.handle('find the cheapest laptop');
    await settle();
    expect(env.output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/you didn't say that text/) });
    await env.assistant.handle('no');
    await run;
    expect(env.backend.actions.some((a) => a.type === 'type')).toBe(false);
  });

  test('clicking an off-site "prize" link needs confirmation', async () => {
    const provider = new ScriptedProvider([], true);
    const env = setup({ provider });
    await env.backend.navigate('https://reviews.example/laptops');
    const prize = await digestRef(env.backend, (d) => d.links.find((l) => /prize/.test(l.text))!.ref);
    provider['script'].push({ text: '', toolCalls: [{ id: '1', name: 'click', arguments: { ref: prize } }] }, { text: 'Done', toolCalls: [] });
    const run = env.assistant.handle('find the cheapest laptop');
    await settle();
    expect(env.output.last()!.kind).toBe('confirm');
    await env.assistant.handle('no');
    await run;
    expect(env.backend.actions.some((a) => a.type === 'click')).toBe(false);
  });

  test('in ask mode, action tools are not even offered, and calls to them fail', async () => {
    const { backend, run } = await injected(
      [
        { text: '', toolCalls: [{ id: '1', name: 'navigate', arguments: { url: 'https://evil.example/collect' } }] },
        { text: 'The Aero 14 costs $499.', toolCalls: [] },
      ],
      'what is the cheapest laptop?',
    );
    await run;
    expect(backend.navigations).not.toContain('https://evil.example/collect');
  });

  test('subscribing on an attacker form still goes through the safety gate', async () => {
    const provider = new ScriptedProvider([], true);
    const env = setup({ provider });
    await env.backend.navigate('https://reviews.example/laptops');
    const btn = await digestRef(env.backend, (d) => d.controls.find((c) => c.name === 'Subscribe')!.ref);
    provider['script'].push({ text: '', toolCalls: [{ id: '1', name: 'click', arguments: { ref: btn } }] }, { text: 'Done', toolCalls: [] });
    const run = env.assistant.handle('subscribe me to the newsletter');
    await settle();
    expect(env.output.last()).toMatchObject({ kind: 'confirm', text: expect.stringMatching(/(press|submit) "Subscribe" on reviews\.example\. Warning: this form sends your information to a different site, evil\.example/) });
    await env.assistant.handle('no');
    await run;
    expect(env.backend.actions.some((a) => a.type === 'click')).toBe(false);
  });
});

describe('regressions from the code review', () => {
  test('a pending approval never carries over to a new page (#2)', async () => {
    const { backend, assistant } = setup({ pages: { 'https://x.example/': '<main><button>Delete draft</button></main>', 'https://x.example/next': '<main><button>Place order</button></main>' } });
    await backend.navigate('https://x.example/');
    const p = assistant.handle('click delete draft');
    await settle();
    // The page navigates by itself while the user is being asked.
    await backend.navigate('https://x.example/next');
    await settle();
    await assistant.handle('yes');
    await p;
    expect(backend.actions.some((a) => a.type === 'click')).toBe(false);
  });

  test('model navigation to a lookalike is denied even if the user said the brand (#5)', async () => {
    const provider = new ScriptedProvider([
      { text: '', toolCalls: [{ id: '1', name: 'navigate', arguments: { url: 'https://paypa1.com/login' } }] },
      { text: 'Blocked.', toolCalls: [] },
    ], true);
    const { backend, output, assistant } = setup({ provider });
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('pay my paypal bill');
    expect(backend.navigations).not.toContain('https://paypa1.com/login');
    expect(output.texts().join(' ')).toMatch(/fake or dangerous site/);
  });

  test('when the model moves to a "never" site, nothing from it is sent (#4)', async () => {
    const provider = new ScriptedProvider([], true);
    const env = setup({ provider, pages: { 'https://bank.example/': '<title>Bank</title><main><p>Balance: $12,345.67</p></main>', 'https://news.example/': '<main><p>News text here for reading.</p><a href="https://bank.example/">My bank</a></main>' } });
    env.assistant.consent.set('https://bank.example', 'never');
    await env.backend.navigate('https://news.example/');
    const link = (await env.backend.digest()).links[0]!.ref;
    provider['script'].push(
      { text: '', toolCalls: [{ id: '1', name: 'click', arguments: { ref: link } }] },
      { text: '', toolCalls: [{ id: '2', name: 'get_outline', arguments: {} }] },
      { text: 'Done.', toolCalls: [] },
    );
    const run = env.assistant.handle('get my balance from bank.example');
    await settle();
    // Navigation completes in the fake via the click; answer any prompt with no.
    if (env.assistant.awaitingAnswer) await env.assistant.handle('no');
    await run;
    expect(env.backend.navigations).toContain('https://bank.example/');
    const sent = provider.calls.flatMap((c) => c.messages.map((m) => m.content)).join('\n');
    expect(sent).not.toMatch(/12,345/);
    expect(sent).toMatch(/has not allowed sending bank\.example/);
  });

  test('tool results are redacted, not only the first page context (#4)', async () => {
    const provider = new ScriptedProvider([
      { text: '', toolCalls: [{ id: '1', name: 'find_text', arguments: { query: 'code' } }] },
      { text: 'OK', toolCalls: [] },
    ], true);
    const { backend, assistant } = setup({ provider, pages: { 'https://m.example/': '<main><p>Your verification code is 482913. Do not share it.</p></main>' } });
    await backend.navigate('https://m.example/');
    await assistant.handle('what is my code?');
    const sent = provider.calls.flatMap((c) => c.messages.map((m) => m.content)).join('\n');
    expect(sent).not.toMatch(/482913/);
  });

  test('errors are spoken instead of silence (#9)', async () => {
    const { backend, output, assistant } = setup();
    backend.navigate = async () => {
      throw new Error("I couldn't find that website.");
    };
    await assistant.handle('go to examplee.com');
    expect(output.last()).toMatchObject({ kind: 'error', text: "I couldn't find that website." });
  });
});

describe('small models without tool calling', () => {
  test('JSON protocol works end to end', async () => {
    const provider = new ScriptedProvider(
      [
        { text: '{"tool": "find_text", "args": {"query": "potassium"}}', toolCalls: [] },
        { text: '{"answer": "Use a high-potassium feed once the first flowers appear."}', toolCalls: [] },
      ],
      true,
      false,
    );
    const { backend, output, assistant } = setup({ provider });
    await backend.navigate('https://garden.example/tomatoes');
    await assistant.handle('when should I start feeding?');
    expect(provider.calls[0]!.tools).toBeUndefined();
    expect(provider.calls[0]!.messages[0]!.content).toMatch(/reply with ONLY a JSON object/);
    expect(provider.calls[1]!.messages.at(-1)!.content).toMatch(/Result of find_text[\s\S]*high-potassium/);
    expect(output.log.find((a) => a.source === 'ai')!.text).toBe('Use a high-potassium feed once the first flowers appear.');
  });
});
