/**
 * The assistant: input → offline grammar → (optional) BYO-model planner →
 * policy + safety gate → backend → narration.
 *
 * Design rules (see PLAN §3 and ADVERSARIAL_REVIEW):
 *  - Content first: on load, warnings, then title and page kind, then content.
 *  - Always interruptible: every new input barges in.
 *  - Nothing consequential without confirmation built from trusted facts.
 *  - Confirmations never time out and accept typed answers (braille users).
 */
import type { BrowserBackend } from '../backend/backend.js';
import type { Block, ControlInfo, PageDigest } from '../types.js';
import { isQuestion, parseCommand, type Intent, type MoveUnit, type Target } from '../commands/grammar.js';
import { resolveTarget, type Candidate } from '../commands/resolve.js';
import { assessAction, buildConfirmation, interpretAnswer, type Confirmation, type RiskAssessment } from '../safety/gate.js';
import { checkPolicy, type AssistantMode, type PlannedAction, type TaskContext } from '../safety/policy.js';
import { assessUrl, siteOf, speakableSite } from '../safety/url-safety.js';
import { AuditLog, ConsentStore, redactText, sensitiveCategory } from '../privacy/privacy.js';
import { looksLikeSpokenEmail, normalizeDictation, toUrl } from '../text/dictation.js';
import type { ModelProvider, ToolCall } from '../ai/provider.js';
import { pageContext, runPlanner } from '../ai/planner.js';
import { verifyAgainstSource } from '../ai/verify.js';
import type { Announcement, AnnouncementKind, Output, Profile, Source, Verbosity } from '../speech/output.js';

export interface Settings {
  profile: Profile;
  verbosity: Verbosity;
  /** What to do when an article-like page loads. */
  autoRead: 'content' | 'summary' | 'outline';
  homeUrl: string;
  /** Search URL with %s for the query. Default is a lightweight, tracker-free results page. */
  searchUrl: string;
  listPageSize: number;
  /** Blocks per "continue" chunk in text-only profiles. */
  readChunk: number;
}

/** Short, spoken form of DISCLAIMER.md. Said at launch and on "disclaimer". */
export const SPOKEN_DISCLAIMER =
  'Frontier is an experimental, unmaintained side project with no warranty and no guarantee that it is safe, accurate, or meets any law or accessibility standard. ' +
  'Its warnings and AI answers can be wrong. Do not rely on it alone for medical, legal, money, or emergency matters. Using it means you accept the disclaimer in the DISCLAIMER file. Say "disclaimer" to hear this again.';

export const DEFAULT_SETTINGS: Settings = {
  profile: 'voice',
  verbosity: 'normal',
  autoRead: 'content',
  homeUrl: 'about:blank',
  searchUrl: 'https://html.duckduckgo.com/html/?q=%s',
  listPageSize: 10,
  readChunk: 5,
};

export interface AssistantDeps {
  backend: BrowserBackend;
  output: Output;
  settings?: Partial<Settings>;
  provider?: ModelProvider | null;
  consent?: ConsentStore;
  audit?: AuditLog;
  random?: () => number;
}

type ConsentAnswer = 'once' | 'always' | 'never' | null;

function parseConsent(input: string): ConsentAnswer | undefined {
  const a = input.toLowerCase();
  if (/\balways\b/.test(a)) return 'always';
  if (/\bnever\b/.test(a)) return 'never';
  if (/\b(no|cancel|stop|don'?t)\b/.test(a)) return null;
  if (/\b(once|yes|ok|okay|sure|this time|just this)\b/.test(a)) return 'once';
  return undefined;
}

const KIND_PHRASE: Record<PageDigest['kind'], string> = {
  article: 'Article',
  'search-results': 'Search results',
  form: 'Form',
  product: 'Product page',
  listing: 'List of links',
  app: 'Web app',
  page: '',
};

export class Assistant {
  readonly settings: Settings;
  provider: ModelProvider | null;
  readonly consent: ConsentStore;
  readonly audit: AuditLog;

  private digest: PageDigest | null = null;
  private readPos = 0;
  private readingToken = 0;
  private lastAnnouncement: Announcement | null = null;
  private lastList: Candidate[] = [];
  private listItems: { text: string; candidate: Candidate }[] = [];
  private listOffset = 0;
  private cursors: Partial<Record<MoveUnit, number>> = {};
  private pendingConfirm: { confirmation: Confirmation; resolve: (ok: boolean) => void } | null = null;
  private pendingConsent: { resolve: (a: ConsentAnswer) => void } | null = null;
  private pendingChoice: { options: Candidate[]; run: (c: Candidate) => Promise<void> } | null = null;
  private planner: AbortController | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: AssistantDeps) {
    this.settings = { ...DEFAULT_SETTINGS, ...deps.settings };
    this.provider = deps.provider ?? null;
    this.consent = deps.consent ?? new ConsentStore();
    this.audit = deps.audit ?? new AuditLog();
    const offLoad = deps.backend.onPageLoaded(() => void this.pageLoaded());
    const offDialog = deps.backend.onDialog?.((dlg) => {
      const what = dlg.type === 'alert' ? 'a message' : dlg.type === 'confirm' ? 'a question, which I answered "cancel" for safety' : 'a request for input, which I dismissed';
      void this.say(`The page showed ${what}.`, 'alert');
      void this.say(dlg.message, 'info', 'page');
    });
    this.unsubscribe = () => {
      offLoad();
      offDialog?.();
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.planner?.abort();
  }

  /** True while waiting on the user to confirm, consent or choose. */
  get awaitingAnswer(): boolean {
    return !!(this.pendingConfirm || this.pendingConsent || this.pendingChoice);
  }

  // ---- Output helpers ------------------------------------------------------

  private async say(text: string, kind: AnnouncementKind = 'info', source: Source = 'browser', lang?: string) {
    const a: Announcement = { text, kind, source, ...(lang ? { lang } : {}) };
    if (kind !== 'content') this.lastAnnouncement = a;
    return this.deps.output.announce(a);
  }

  private get terse(): boolean {
    return this.settings.verbosity === 'terse';
  }
  private get guided(): boolean {
    return this.settings.verbosity === 'guided';
  }
  private hint(text: string): Promise<unknown> | void {
    if (!this.terse) return this.say(text, 'hint');
  }

  private async currentDigest(fresh = false): Promise<PageDigest> {
    // Never answer from a previous page's digest.
    if (!this.digest || fresh || this.digest.url !== this.deps.backend.currentUrl()) this.digest = await this.deps.backend.digest();
    return this.digest;
  }

  // ---- Input -----------------------------------------------------------------

  /** Handle one typed or transcribed utterance. */
  async handle(rawInput: string): Promise<void> {
    const input = rawInput.trim();
    if (!input) return;
    // Barge-in: stop speaking and stop any continuous reading.
    this.deps.output.interrupt();
    this.readingToken++;
    const intent = parseCommand(input);

    if (intent?.type === 'panic') return this.panic();

    if (this.pendingConsent) {
      const answer = parseConsent(input);
      if (answer === undefined) {
        await this.say('Please say "once", "always", or "never". Or say "cancel".', 'confirm');
        return;
      }
      const p = this.pendingConsent;
      this.pendingConsent = null;
      p.resolve(answer);
      return;
    }

    if (this.pendingConfirm) {
      const p = this.pendingConfirm;
      const verdict = interpretAnswer(input, p.confirmation);
      if (verdict === 'unclear') {
        const word = p.confirmation.challenge;
        await this.say(word ? `I didn't hear the word. To go ahead, say "confirm ${word}". To stop, say "cancel".` : 'Please say "yes" to go ahead or "no" to cancel.', 'confirm');
        return;
      }
      this.pendingConfirm = null;
      p.resolve(verdict === 'approved');
      return;
    }

    if (this.pendingChoice) {
      const p = this.pendingChoice;
      this.pendingChoice = null;
      if (intent?.type === 'activate' && intent.target.ordinal !== undefined) {
        const idx = intent.target.ordinal < 0 ? p.options.length + intent.target.ordinal : intent.target.ordinal - 1;
        const choice = p.options[idx];
        if (choice) return p.run(choice);
      }
      const byName = p.options.find((o) => o.label.toLowerCase() === input.toLowerCase());
      if (byName) return p.run(byName);
      if (intent?.type === 'no') {
        await this.say('Cancelled.');
        return;
      }
      // Anything else is a new command.
    }

    if (this.planner && intent?.type !== 'yes' && intent?.type !== 'no') {
      this.planner.abort();
      this.planner = null;
    }

    try {
      if (intent) await this.execute(intent, input);
      else await this.askModel(input);
    } catch (e) {
      // Never leave the user with silence (review #9).
      await this.say((e as Error).message || 'Something went wrong.', 'error');
    }
  }

  private confirm(c: Confirmation): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingConfirm = { confirmation: c, resolve };
      void this.say(c.prompt, 'confirm');
    });
  }

  private async gate(assessment: RiskAssessment, d: PageDigest, ref?: string): Promise<boolean> {
    if (assessment.risk === 'none') return true;
    const urlBefore = this.deps.backend.currentUrl();
    const c = buildConfirmation(assessment, d, { committedUrl: urlBefore, random: this.deps.random });
    const ok = await this.confirm(c);
    if (!ok) {
      await this.say('Cancelled. Nothing was done.');
      return false;
    }
    // The approval was for THAT element on THAT page. If either changed while
    // we waited, the approval is void (review #2).
    const labelOf = (dg: PageDigest, r: string) => dg.controls.find((x) => x.ref === r)?.name ?? dg.links.find((x) => x.ref === r)?.text;
    let changed = this.deps.backend.currentUrl() !== urlBefore;
    if (!changed && ref) {
      const now = await this.currentDigest(true);
      changed = labelOf(now, ref) !== labelOf(d, ref);
    }
    if (changed) {
      await this.say('The page changed while I was waiting for you, so I did not do it. Nothing was done.', 'alert');
      return false;
    }
    return true;
  }

  // ---- Page load: content first ------------------------------------------------

  async pageLoaded(): Promise<void> {
    this.readingToken++;
    this.pendingChoice = null;
    if (this.pendingConfirm) {
      // A pending approval never carries over to a new page (review #2).
      const p = this.pendingConfirm;
      this.pendingConfirm = null;
      p.resolve(false);
    }
    this.cursors = {};
    this.readPos = 0;
    this.lastList = [];
    this.consent.clearOnce();
    this.digest = null;
    const url = this.deps.backend.currentUrl();
    if (url === 'about:blank' || url === this.settings.homeUrl) {
      await this.say('Home. Say "go to" and a website, or "search for" something.');
      return;
    }
    let d: PageDigest;
    try {
      d = await this.currentDigest(true);
    } catch (e) {
      await this.say(`I couldn't read this page. ${(e as Error).message}`, 'error');
      return;
    }

    // 1. Safety first — before any page content is spoken (AR-11).
    const urlCheck = assessUrl(url);
    for (const w of urlCheck.warnings) await this.say(w, 'alert');
    for (const w of d.warnings.filter((w) => w.kind === 'scam-suspected' || w.kind === 'insecure-password')) await this.say(w.message, 'alert');
    const scam = urlCheck.dangerous || d.warnings.some((w) => w.kind === 'scam-suspected');

    // 2. Where am I.
    const kind = this.kindPhrase(d);
    // The title is page-controlled: it is spoken as page text, then our own facts.
    await this.say(`${d.title}.`, 'info', 'page');
    if (kind) await this.say(`${kind}.`);
    for (const w of d.warnings.filter((w) => !['scam-suspected', 'insecure-password', 'unlabelled-controls'].includes(w.kind))) {
      await this.say(w.message, 'alert');
    }
    if (this.planner) return; // An AI task is driving; don't start reading over it.
    if (scam) {
      await this.say('I will not read this page aloud automatically. Say "get me out" to leave, or "read" if you are sure.', 'hint');
      return;
    }

    // 3. Content, by page kind (AR-16: apps and forms get orientation, not a flood).
    switch (d.kind) {
      case 'search-results':
        return this.readResults(d);
      case 'form':
        return this.describeForm(d);
      case 'app':
      case 'listing':
        await this.hint('Say "what can I do here", "headings", or "links".');
        return;
      default:
        if (this.settings.autoRead === 'outline') return this.listThings('headings');
        if (this.settings.autoRead === 'summary' && this.provider) return this.summarize(d);
        if (d.kind === 'product') await this.describeProduct(d);
        return this.readFrom(this.firstContentIndex(d));
    }
  }

  private kindPhrase(d: PageDigest): string {
    const base = KIND_PHRASE[d.kind];
    if (d.kind === 'article') {
      const words = d.main.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
      const mins = Math.max(1, Math.round(words / 200));
      return `${base}, about ${mins} minute${mins === 1 ? '' : 's'} to read`;
    }
    if (d.kind === 'form') {
      const n = d.controls.filter((c) => c.kind !== 'button' && c.kind !== 'submit').length;
      return `${base} with ${n} field${n === 1 ? '' : 's'}`;
    }
    return base;
  }

  private firstContentIndex(d: PageDigest): number {
    // Skip a leading heading that just repeats the title we already spoke.
    const first = d.main[0];
    if (first?.kind === 'heading' && d.title.toLowerCase().includes(first.text.toLowerCase())) return 1;
    return 0;
  }

  private blockText(b: Block): string {
    if (b.kind === 'heading' && !this.terse) return `Heading${this.guided ? ' level ' + (b.level ?? 2) : ''}: ${b.text}`;
    if (b.kind === 'list-item' && this.guided) return `List item: ${b.text}`;
    return b.text;
  }

  /** Continuous reading with position memory; any input interrupts. */
  private async readFrom(start: number): Promise<void> {
    const d = await this.currentDigest();
    if (!d.main.length) {
      await this.say('This page has no readable text.');
      await this.hint('Say "what can I do here" to explore it.');
      return;
    }
    if (start >= d.main.length) {
      await this.say('End of the page.');
      return;
    }
    const token = ++this.readingToken;
    const chunk = this.settings.profile === 'voice' ? Infinity : this.settings.readChunk;
    let spoken = 0;
    for (let i = start; i < d.main.length; i++) {
      if (token !== this.readingToken) return;
      this.readPos = i;
      const r = await this.say(this.blockText(d.main[i]!), 'content', 'page', d.lang || undefined);
      if (r === 'interrupted' || token !== this.readingToken) return;
      this.readPos = i + 1;
      if (++spoken >= chunk && i + 1 < d.main.length) {
        await this.say(`Say "continue" for more. ${d.main.length - i - 1} more blocks.`, 'hint');
        return;
      }
    }
    if (token === this.readingToken) await this.say('End of the page.');
  }

  private async readResults(d: PageDigest): Promise<void> {
    const results = d.links.filter((l) => l.inMain && l.text.length > 12).slice(0, 10);
    if (!results.length) {
      await this.say('I could not find any results on this page.');
      return;
    }
    this.lastList = results.map((l) => ({ ref: l.ref, label: l.text, kind: 'link' as const }));
    const top = results.slice(0, 3).map((l, i) => `${i + 1}: ${l.text}`).join('. ');
    await this.say(`Top results. ${top}.`, 'list', 'page');
    await this.hint('Say a number to open one, "more" for more results, or "read" to hear the whole page.');
    this.listItems = this.lastList.map((c, i) => ({ text: `${i + 1}: ${c.label}`, candidate: c }));
    this.listOffset = 3;
  }

  private describeControl(c: ControlInfo): string {
    const kindWord: Record<string, string> = {
      textbox: 'text field', textarea: 'text area', search: 'search box', email: 'email field', password: 'password field',
      number: 'number field', tel: 'phone field', url: 'web address field', date: 'date field', checkbox: 'checkbox', radio: 'option',
      select: 'dropdown', button: 'button', submit: 'button', slider: 'slider', file: 'file upload', combobox: 'combo box', switch: 'switch',
    };
    const parts = [`${c.name || 'Unlabelled'}, ${kindWord[c.kind] ?? c.kind}`];
    if (c.required) parts.push('required');
    if (c.disabled) parts.push('unavailable');
    if (c.checked !== undefined) parts.push(c.checked ? 'checked' : 'not checked');
    if (c.sensitive) parts.push(c.hasValue ? 'filled in' : 'empty');
    else if (c.value && c.kind !== 'button' && c.kind !== 'submit') parts.push(`currently "${c.value}"`);
    if (c.invalid) parts.push(`has a problem${c.error ? ': ' + c.error : ''}`);
    if (this.guided && c.description) parts.push(c.description);
    return parts.join(', ');
  }

  private async describeForm(d: PageDigest): Promise<void> {
    const fields = d.controls.filter((c) => c.kind !== 'button' && c.kind !== 'submit');
    const names = fields.slice(0, 8).map((c) => c.name || 'unlabelled').join(', ');
    await this.say(`Fields: ${names}${fields.length > 8 ? `, and ${fields.length - 8} more` : ''}.`);
    if (d.main.length && d.main[0]!.text.length > 40) await this.say(d.main[0]!.text, 'content', 'page', d.lang || undefined);
    await this.hint(this.guided ? 'To fill a field say, for example, "fill email with" and then your email. Say "list fields" to hear them all, and "submit" when you are done.' : 'Say "fill" and a field name, or "list fields".');
  }

  private async describeProduct(d: PageDigest): Promise<void> {
    const text = d.main.map((b) => b.text).join(' ');
    const price = /([$€£¥₹]\s?\d[\d,]*(?:\.\d{2})?)/.exec(text);
    if (price) await this.say(`The page shows a price of ${price[1]}.`, 'info', 'page');
    const cart = d.controls.find((c) => /add to (cart|bag|basket)|buy now/i.test(c.name));
    if (cart) await this.hint(`Say "${cart.name.toLowerCase()}" when you're ready.`);
  }

  // ---- Intents -----------------------------------------------------------------

  private async execute(intent: Intent, raw: string): Promise<void> {
    const b = this.deps.backend;
    switch (intent.type) {
      case 'stop':
        if (this.settings.profile !== 'voice') await this.say('Stopped.');
        return;
      case 'panic':
        return this.panic();
      case 'yes':
      case 'no':
        await this.say("There's nothing to confirm right now.");
        return;
      case 'help':
        return this.help();
      case 'discover':
        return this.discover();
      case 'where':
        return this.where();
      case 'back':
        if (!(await b.back())) await this.say("There's no previous page.");
        return;
      case 'forward':
        if (!(await b.forward())) await this.say("There's no next page.");
        return;
      case 'reload':
        await this.say('Reloading.');
        await b.reload();
        return;
      case 'home':
        await b.navigate(this.settings.homeUrl);
        return;
      case 'navigate':
        return this.navigate(intent.target);
      case 'search':
        if (intent.site) return this.searchSite(intent.query);
        await this.say(`Searching for ${intent.query}.`);
        await b.navigate(this.settings.searchUrl.replace('%s', encodeURIComponent(intent.query)));
        return;
      case 'read': {
        const d = await this.currentDigest();
        if (intent.what === 'title') {
          await this.say(d.title);
          return;
        }
        if (intent.what === 'description') {
          await this.say(d.description || 'This page has no description.', 'info', 'page');
          return;
        }
        if (intent.what === 'summary') return this.summarize(d);
        return this.readFrom(this.firstContentIndex(d));
      }
      case 'continue':
        return this.readFrom(this.readPos);
      case 'repeat':
        if (this.lastAnnouncement) await this.deps.output.announce(this.lastAnnouncement);
        else await this.say('Nothing to repeat yet.');
        return;
      case 'more':
        return this.moreOfList();
      case 'move':
        return this.move(intent.dir, intent.unit, intent.level);
      case 'jump':
        return this.jump(intent.to);
      case 'list':
        return this.listThings(intent.what);
      case 'activate':
        return this.activate(intent.target);
      case 'fill':
        return this.fill(intent.target, intent.value);
      case 'check':
        return this.check(intent.target, intent.checked);
      case 'choose':
        return this.choose(intent.target, intent.option);
      case 'submit':
        return this.submit();
      case 'find':
        return this.find(intent.text, raw);
      case 'speech':
        return this.speech(intent.setting);
      case 'images':
        return this.listThings('images');
      case 'sent-log':
        return this.sentLog();
      case 'disclaimer':
        await this.say(SPOKEN_DISCLAIMER, 'info');
        return;
      case 'privacy-notice':
        for (const line of [
          "Frontier doesn't collect anything about you: no tracking, no account, no analytics.",
          'Websites are not told that you use Frontier.',
          this.provider
            ? `Your AI is ${this.provider.label}${this.provider.isLocal ? ', which runs on your own computer, so nothing leaves it' : '. Before sending part of a site to it, I ask you once for each site. Say "what did you send" to check, or "never send this site to the AI" to block a site'}.`
            : 'No AI is connected, so nothing is sent anywhere except the pages you visit.',
          'AI answers are always labelled, and they are not professional advice.',
        ])
          await this.say(line, 'list');
        return;
      case 'privacy': {
        const origin = (await this.currentDigest()).origin;
        if (intent.action === 'never-ai-here') {
          this.consent.set(origin, 'never');
          await this.say(`Done. I will never send ${siteOf(b.currentUrl())} to an AI model.`);
        } else {
          this.consent.forget(origin);
          await this.say(`I forgot your AI choice for ${siteOf(b.currentUrl())}. I'll ask again next time.`);
        }
        return;
      }
      default: {
        const _never: never = intent;
        void _never;
      }
    }
  }

  private async panic(): Promise<void> {
    this.deps.output.interrupt();
    this.readingToken++;
    this.planner?.abort();
    this.planner = null;
    this.pendingConfirm?.resolve(false);
    this.pendingConfirm = null;
    this.pendingConsent?.resolve(null);
    this.pendingConsent = null;
    this.pendingChoice = null;
    await this.deps.backend.navigate(this.settings.homeUrl);
    await this.say("You're safe. I closed that page and went to your home page. Nothing on that page was submitted.", 'alert');
  }

  private async help(): Promise<void> {
    const lines = this.terse
      ? ['Commands: go to, search for, read, continue, stop, headings, links, next heading, click, fill, submit, back, what can I do here, where am I, get me out.']
      : [
          'Here are things you can say.',
          'To go somewhere: "go to" and a website, or "search for" something. "Back" goes back.',
          'To read: "read", "continue", "stop", "repeat", and "summarize".',
          'To skim: "headings", "links", "next heading", "next link", "skip to main content".',
          'To act: "click" and a name or number, "fill email with" and your email, "check", "choose", and "submit". I will ask before anything important.',
          'To explore: "what can I do here" and "where am I".',
          'If a page frightens or confuses you, say "get me out".',
          this.provider ? 'You can also ask me anything about the page in your own words.' : 'If you connect an AI model in Settings, you can also ask questions in your own words.',
        ];
    for (const l of lines) await this.say(l, 'list');
  }

  /** Deterministic "what can I do here" — the page can't steer it (AR-16). */
  private async discover(): Promise<void> {
    const d = await this.currentDigest();
    const options: string[] = [];
    const search = d.controls.find((c) => c.kind === 'search' || /search/i.test(c.name));
    const paragraphs = d.main.filter((b) => b.kind === 'paragraph' || b.kind === 'text').length;
    if (paragraphs >= 3) options.push(`read the main text, ${paragraphs} paragraphs. Say "read"`);
    if (d.headings.length >= 2) options.push(`skim ${d.headings.length} headings. Say "headings"`);
    if (d.kind === 'search-results') options.push('hear the results. Say "list results"');
    const fields = d.controls.filter((c) => !['button', 'submit', 'search'].includes(c.kind));
    if (fields.length) options.push(`fill in a form with ${fields.length} field${fields.length === 1 ? '' : 's'}. Say "list fields"`);
    const cart = d.controls.find((c) => /add to (cart|bag|basket)|buy now|checkout/i.test(c.name));
    if (cart) options.push(`press "${cart.name}"`);
    if (search) options.push('search this site. Say "search this site for" and your words');
    const mainLinks = d.links.filter((l) => l.inMain).length;
    if (mainLinks) options.push(`follow one of ${mainLinks} links in the content. Say "links"`);
    if (d.warnings.length) options.push(`hear ${d.warnings.length} warning${d.warnings.length === 1 ? '' : 's'}. Say "warnings"`);
    if (!options.length) options.push('go back. Say "back"', 'search the web. Say "search for" and your words');
    await this.say(`On this page you can: ${options.slice(0, 5).map((o, i) => `${i + 1}, ${o}`).join('. ')}.`, 'list');
  }

  private async where(): Promise<void> {
    const d = await this.currentDigest();
    const site = siteOf(this.deps.backend.currentUrl());
    const kind = this.kindPhrase(d);
    let msg = `You're on "${d.title}" at ${site || 'a local page'}.${kind ? ' ' + kind + '.' : ''}`;
    if (d.main.length) msg += ` Reading position: block ${Math.min(this.readPos + 1, d.main.length)} of ${d.main.length}.`;
    await this.say(msg);
    if (d.focused) await this.say(`Focus is on: ${await this.deps.backend.describe(d.focused)}.`);
  }

  private async navigate(target: string): Promise<void> {
    const url = toUrl(target);
    if (url) {
      await this.say(`Opening ${siteOf(url) || url}.`);
      await this.deps.backend.navigate(url);
      return;
    }
    // "go to the contact page" → a matching link on this page, if there is one.
    const name = target.replace(/^(the|my)\s+/i, '').replace(/\s+(page|section|link|tab)$/i, '');
    const d = await this.currentDigest();
    const r = resolveTarget({ kind: 'any', name }, d);
    if (r.status === 'found' && r.candidate.kind !== 'field') return this.activateCandidate(r.candidate);
    await this.say(`Searching for ${target}.`);
    await this.deps.backend.navigate(this.settings.searchUrl.replace('%s', encodeURIComponent(target)));
  }

  private async searchSite(query: string): Promise<void> {
    const d = await this.currentDigest();
    const box = d.controls.find((c) => c.kind === 'search') ?? d.controls.find((c) => /search/i.test(c.name) && c.kind !== 'button' && c.kind !== 'submit');
    if (!box) {
      await this.say("This site doesn't have a search box I can find. I'll search the web instead.");
      await this.deps.backend.navigate(this.settings.searchUrl.replace('%s', encodeURIComponent(`site:${siteOf(this.deps.backend.currentUrl())} ${query}`)));
      return;
    }
    const r = await this.deps.backend.act({ type: 'type', ref: box.ref, text: query });
    if (!r.ok) return void (await this.say(r.message ?? 'I could not type in the search box.', 'error'));
    await this.say(`Searching this site for ${query}.`);
    const res = await this.deps.backend.act({ type: 'submit', ref: box.ref });
    if (!res.ok) await this.say(res.message ?? 'I could not submit the search.', 'error');
  }

  private unitItems(d: PageDigest, unit: MoveUnit, level?: number): Candidate[] {
    switch (unit) {
      case 'heading':
        return d.headings.filter((h) => !level || h.level === level).map((h) => ({ ref: h.ref, label: `${this.terse ? '' : `Heading level ${h.level}: `}${h.text}`, kind: 'heading' }));
      case 'link':
        return d.links.map((l) => ({ ref: l.ref, label: `Link: ${l.text}${l.external && !this.terse ? ', goes to another site' : ''}`, kind: 'link' }));
      case 'landmark':
        return d.landmarks.map((l) => ({ ref: l.ref, label: `${l.role} region${l.name ? ': ' + l.name : ''}`, kind: 'landmark' }));
      case 'control':
        return d.controls.map((c) => ({ ref: c.ref, label: this.describeControl(c), kind: c.kind === 'button' || c.kind === 'submit' ? 'button' : 'field' }));
      default:
        return [];
    }
  }

  private async move(dir: 'next' | 'previous', unit: MoveUnit, level?: number): Promise<void> {
    const d = await this.currentDigest();
    if (unit === 'paragraph' || unit === 'item') {
      const i = dir === 'next' ? this.readPos : Math.max(0, this.readPos - 2);
      const blk = d.main[i];
      if (!blk) return void (await this.say(dir === 'next' ? 'End of the page.' : 'Top of the page.'));
      this.readPos = i + 1;
      await this.say(this.blockText(blk), 'content', 'page', d.lang || undefined);
      return;
    }
    const items = this.unitItems(d, unit, level);
    if (!items.length) return void (await this.say(`There are no ${unit}s${level ? ' at level ' + level : ''} on this page.`));
    const key = (unit + (level ?? '')) as MoveUnit;
    const cur = this.cursors[key];
    const next = cur === undefined ? (dir === 'next' ? 0 : items.length - 1) : dir === 'next' ? cur + 1 : cur - 1;
    if (next < 0 || next >= items.length) return void (await this.say(dir === 'next' ? `No more ${unit}s.` : `No earlier ${unit}s.`));
    this.cursors[key] = next;
    const item = items[next]!;
    // One deliberate focus move per action, so the screen reader follows (AR-8).
    await this.deps.backend.act({ type: 'focus', ref: item.ref });
    const blockIdx = d.main.findIndex((b) => b.ref === item.ref);
    if (blockIdx >= 0) this.readPos = blockIdx + 1;
    this.lastList = [item];
    await this.say(item.label, 'info', 'page');
  }

  private async jump(to: 'main' | 'top' | 'end' | 'search'): Promise<void> {
    const d = await this.currentDigest();
    if (to === 'search') {
      const box = d.controls.find((c) => c.kind === 'search') ?? d.controls.find((c) => /search/i.test(c.name) && c.kind !== 'button');
      if (!box) return void (await this.say("I can't find a search box on this page."));
      await this.deps.backend.act({ type: 'focus', ref: box.ref });
      await this.say(`${this.describeControl(box)}. Say "search this site for" and your words.`);
      return;
    }
    if (to === 'end') {
      this.readPos = Math.max(0, d.main.length - 1);
      return this.readFrom(this.readPos);
    }
    const first = d.main[0];
    if (first) await this.deps.backend.act({ type: 'focus', ref: first.ref });
    return this.readFrom(to === 'main' ? this.firstContentIndex(d) : 0);
  }

  private async listThings(what: string): Promise<void> {
    const d = await this.currentDigest();
    let items: Candidate[] = [];
    let noun = what;
    switch (what) {
      case 'headings':
        items = d.headings.map((h) => ({ ref: h.ref, label: this.terse ? h.text : `level ${h.level}, ${h.text}`, kind: 'heading' }));
        break;
      case 'links': {
        // Content links first; chrome links (nav, footer) after.
        const sorted = [...d.links.filter((l) => l.inMain), ...d.links.filter((l) => !l.inMain)];
        items = sorted.map((l) => ({ ref: l.ref, label: l.text, kind: 'link' }));
        break;
      }
      case 'landmarks':
        items = d.landmarks.map((l) => ({ ref: l.ref, label: `${l.role}${l.name ? ' ' + l.name : ''}`, kind: 'landmark' }));
        noun = 'regions';
        break;
      case 'buttons':
        items = d.controls.filter((c) => c.kind === 'button' || c.kind === 'submit').map((c) => ({ ref: c.ref, label: c.name || 'unlabelled button', kind: 'button' }));
        break;
      case 'fields':
      case 'controls':
        items = d.controls.filter((c) => what === 'controls' || (c.kind !== 'button' && c.kind !== 'submit')).map((c) => ({ ref: c.ref, label: this.describeControl(c), kind: c.kind === 'button' || c.kind === 'submit' ? 'button' : 'field' }));
        break;
      case 'images': {
        const imgs = d.images.filter((i) => !i.decorative);
        const missing = imgs.filter((i) => !i.alt).length;
        items = imgs.map((i) => ({ ref: i.ref, label: i.alt ? i.alt : 'an image with no description', kind: 'image' }));
        if (missing) await this.say(`${missing} of ${imgs.length} images have no description from the website.`);
        break;
      }
      case 'tables':
        items = d.tables.map((t) => ({ ref: t.ref, label: `${t.caption || 'table'}, ${t.rows} rows, ${t.cols} columns${t.headers.length ? ', columns: ' + t.headers.join(', ') : ''}`, kind: 'text' }));
        break;
      case 'warnings': {
        const urlWarnings = assessUrl(this.deps.backend.currentUrl()).warnings;
        const all = [...urlWarnings, ...d.warnings.map((w) => w.message)];
        if (!all.length) return void (await this.say(`I have no warnings about this page. ${this.terse ? '' : 'That does not guarantee it is safe; be careful with passwords and payments.'}`));
        for (const w of all) await this.say(w, 'alert');
        return;
      }
    }
    if (!items.length) return void (await this.say(`There are no ${noun} on this page.`));
    this.lastList = items;
    this.listItems = items.map((c, i) => ({ text: `${i + 1}: ${c.label}`, candidate: c }));
    this.listOffset = 0;
    await this.say(`${items.length} ${items.length === 1 ? noun.replace(/s$/, '') : noun}.`);
    return this.moreOfList();
  }

  private async moreOfList(): Promise<void> {
    if (this.listOffset >= this.listItems.length) return void (await this.say('That is the end of the list.'));
    const page = this.listItems.slice(this.listOffset, this.listOffset + this.settings.listPageSize);
    this.listOffset += page.length;
    await this.say(page.map((p) => p.text).join('. ') + '.', 'list', 'page');
    const left = this.listItems.length - this.listOffset;
    if (left > 0) await this.hint(`${left} more. Say "more", or a number to choose.`);
    else if (!this.terse) await this.hint('Say a number to choose one.');
  }

  private async withTarget(target: Target, run: (c: Candidate) => Promise<void>): Promise<void> {
    const d = await this.currentDigest();
    const r = resolveTarget(target, d, this.lastList);
    if (r.status === 'found') return run(r.candidate);
    if (r.status === 'ambiguous') {
      this.pendingChoice = { options: r.options, run };
      this.lastList = r.options;
      await this.say(`I found ${r.options.length} matches. Which one? Say a number.`, 'confirm');
      await this.say(r.options.map((o, i) => `${i + 1}, ${o.label}`).join('. ') + '.', 'list', 'page');
      return;
    }
    const what = target.name ? `"${target.name}"` : `number ${target.ordinal}`;
    await this.say(`I couldn't find ${what}${target.kind !== 'any' ? ' among the ' + target.kind + 's' : ''}. ${this.terse ? '' : `Say "${target.kind === 'field' ? 'list fields' : target.kind === 'button' ? 'list buttons' : 'links'}" to hear what's here.`}`);
  }

  private activate(target: Target): Promise<void> {
    return this.withTarget(target, (c) => this.activateCandidate(c));
  }

  private async activateCandidate(c: Candidate): Promise<void> {
    const d = await this.currentDigest();
    if (c.kind === 'heading' || c.kind === 'landmark' || c.kind === 'text') {
      await this.deps.backend.act({ type: 'focus', ref: c.ref });
      const idx = d.main.findIndex((b) => b.ref === c.ref);
      return this.readFrom(idx >= 0 ? idx : this.readPos);
    }
    if (c.kind === 'field') {
      const control = d.controls.find((x) => x.ref === c.ref);
      await this.deps.backend.act({ type: 'focus', ref: c.ref });
      if (control) await this.say(`${this.describeControl(control)}. ${this.terse ? '' : control.kind === 'select' ? `Say "choose" and an option. Options: ${control.options?.slice(0, 6).join(', ')}.` : control.kind === 'checkbox' ? 'Say "check" or "uncheck".' : 'Say "type" and your text, then "into" this field.'}`);
      return;
    }
    if (c.kind === 'image') {
      const img = d.images.find((i) => i.ref === c.ref);
      await this.say(img?.alt ? `Image: ${img.alt}` : 'This image has no description from the website.', 'info', 'page');
      return;
    }
    const assessment = assessAction({ type: 'click', ref: c.ref }, d);
    if (!(await this.gate(assessment, d, c.ref))) return;
    const before = this.deps.backend.currentUrl();
    const res = await this.deps.backend.act({ type: 'click', ref: c.ref });
    if (!res.ok) return void (await this.say(res.message ?? "That didn't work.", 'error'));
    if (c.kind === 'link') return void (await this.say(`Opening ${c.label}.`));
    await this.afterInPageAction(before, `Pressed ${c.label}.`);
  }

  /** After a click/submit that may not navigate: report changes and form errors. */
  private async afterInPageAction(urlBefore: string, done: string): Promise<void> {
    if (this.deps.backend.currentUrl() !== urlBefore) return; // pageLoaded narrates.
    const d = await this.currentDigest(true);
    const bad = d.controls.filter((c) => c.invalid);
    if (bad.length) {
      await this.say(`${done} ${bad.length} field${bad.length === 1 ? ' has a problem' : 's have problems'}.`, 'alert');
      await this.say(bad.slice(0, 4).map((c) => `${c.name}${c.error ? ': ' + c.error : ''}`).join('. ') + '.', 'list', 'page');
      return;
    }
    await this.say(done);
    const modal = d.warnings.find((w) => w.kind === 'modal-open');
    if (modal) await this.say(modal.message, 'alert');
  }

  private fill(target: Target, value: string): Promise<void> {
    return this.withTarget({ ...target, kind: target.kind === 'any' ? 'field' : target.kind }, async (c) => {
      const d = await this.currentDigest();
      const control = d.controls.find((x) => x.ref === c.ref);
      if (!control || c.kind !== 'field') return void (await this.say(`${c.label} isn't a field I can type into.`));
      if (control.kind === 'select') return this.chooseIn(control, value);
      if (control.kind === 'checkbox' || control.kind === 'radio' || control.kind === 'switch') return this.checkControl(control, !/^(no|off|false|unchecked)$/i.test(value));
      let text = value;
      if (control.kind === 'email' || /e-?mail/i.test(control.name) || looksLikeSpokenEmail(value)) text = normalizeDictation(value, 'email');
      else if (control.kind === 'url') text = normalizeDictation(value, 'url');
      const res = await this.deps.backend.act({ type: 'type', ref: control.ref, text });
      if (!res.ok) return void (await this.say(res.message ?? "I couldn't type there.", 'error'));
      if (control.sensitive) {
        // Never echo secrets (AR-7 / E4.10).
        await this.say(`Filled in ${control.name}.${this.settings.profile === 'voice' && !this.terse ? ' Tip: typing secrets on the keyboard is more private than saying them aloud.' : ''}`);
      } else {
        await this.say(`${control.name || 'Field'} set to ${text}.`);
      }
    });
  }

  private async chooseIn(control: ControlInfo, option: string): Promise<void> {
    const res = await this.deps.backend.act({ type: 'select', ref: control.ref, option });
    if (!res.ok) {
      await this.say(`${res.message ?? 'That option is not available.'} ${control.options?.length ? 'Options are: ' + control.options.slice(0, 10).join(', ') + '.' : ''}`);
      return;
    }
    await this.say(`Chose ${res.value ?? option} in ${control.name || 'the list'}.`);
  }

  private choose(target: Target, option: string): Promise<void> {
    return this.withTarget({ ...target, kind: 'field' }, async (c) => {
      const control = (await this.currentDigest()).controls.find((x) => x.ref === c.ref);
      if (!control) return;
      return this.chooseIn(control, option);
    });
  }

  private check(target: Target, checked: boolean): Promise<void> {
    return this.withTarget({ ...target, kind: 'field' }, async (c) => {
      const control = (await this.currentDigest()).controls.find((x) => x.ref === c.ref);
      if (control) return this.checkControl(control, checked);
    });
  }

  private async checkControl(control: ControlInfo, checked: boolean): Promise<void> {
    const d = await this.currentDigest();
    if (!(await this.gate(assessAction({ type: 'check', ref: control.ref, checked }, d), d, control.ref))) return;
    const res = await this.deps.backend.act({ type: 'check', ref: control.ref, checked });
    if (!res.ok) return void (await this.say(res.message ?? "That didn't work.", 'error'));
    await this.say(`${control.name || 'Checkbox'} ${checked ? 'checked' : 'unchecked'}.`);
  }

  private async submit(): Promise<void> {
    const d = await this.currentDigest(true);
    const focusedForm = d.controls.find((c) => c.ref === d.focused)?.form;
    const forms = [...new Set(d.controls.filter((c) => c.form && c.kind !== 'button' && c.kind !== 'submit').map((c) => c.form!))];
    const filled = forms.filter((f) => d.controls.some((c) => c.form === f && (c.value || c.hasValue)));
    const form = focusedForm ?? (forms.length === 1 ? forms[0] : filled.length === 1 ? filled[0] : undefined);
    if (!form) {
      if (!forms.length) return void (await this.say("There's no form on this page to submit."));
      const buttons = d.controls.filter((c) => c.kind === 'submit');
      this.lastList = buttons.map((c) => ({ ref: c.ref, label: c.name, kind: 'button' as const }));
      await this.say(`There are ${forms.length} forms. Say which button to press: ${buttons.map((b, i) => `${i + 1}, ${b.name}`).join('. ')}.`);
      return;
    }
    const field = d.controls.find((c) => c.form === form)!;
    const missing = d.controls.filter((c) => c.form === form && c.required && !c.value && !c.hasValue && c.kind !== 'checkbox');
    if (missing.length) {
      await this.say(`Before submitting: ${missing.map((c) => c.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required and empty.`, 'alert');
      return;
    }
    if (!(await this.gate(assessAction({ type: 'submit', ref: field.ref }, d), d, field.ref))) return;
    const before = this.deps.backend.currentUrl();
    const res = await this.deps.backend.act({ type: 'submit', ref: field.ref });
    if (!res.ok) return void (await this.say(res.message ?? "I couldn't submit the form.", 'error'));
    await this.afterInPageAction(before, 'Submitted.');
  }

  private async find(text: string, raw: string): Promise<void> {
    const hits = await this.deps.backend.findText(text);
    if (!hits.length) {
      // "find a cheaper one" is a request, not a text search.
      if (this.provider && text.split(/\s+/).length > 1) return this.askModel(raw);
      return void (await this.say(`"${text}" is not on this page.`));
    }
    this.lastList = hits.map((h) => ({ ref: h.ref, label: h.text, kind: 'text' as const }));
    const d = await this.currentDigest();
    const idx = d.main.findIndex((b) => b.ref === hits[0]!.ref);
    if (idx >= 0) this.readPos = idx;
    await this.say(`Found ${hits.length} match${hits.length === 1 ? '' : 'es'}. ${hits.length > 1 ? 'First: ' : ''}`);
    await this.say(hits[0]!.text, 'content', 'page', d.lang || undefined);
    if (hits.length > 1) await this.hint('Say a number to jump to a match, or "continue" to read from here.');
  }

  private async speech(setting: string): Promise<void> {
    const out = this.deps.output;
    switch (setting) {
      case 'faster':
        out.adjustRate?.(0.25);
        return void (await this.say('Faster.'));
      case 'slower':
        out.adjustRate?.(-0.25);
        return void (await this.say('Slower.'));
      case 'normal-speed':
        out.adjustRate?.('reset');
        return void (await this.say('Normal speed.'));
      default:
        this.settings.verbosity = setting as Verbosity;
        await this.say(setting === 'terse' ? 'Brief mode.' : setting === 'guided' ? 'Guided mode. I will explain more as we go.' : 'Normal detail.');
    }
  }

  private async sentLog(): Promise<void> {
    const recent = this.audit.recent(5);
    if (!recent.length) return void (await this.say('Nothing has been sent to any AI model.'));
    await this.say(`The last ${recent.length} thing${recent.length === 1 ? '' : 's'} sent to an AI:`);
    for (const e of recent) {
      const site = siteOf(e.origin) || e.origin;
      await this.say(`${new Date(e.time).toLocaleTimeString()}: part of ${site}, about ${Math.round(e.chars / 5)} words, to ${e.provider}${e.local ? ' on this computer' : ''}, for a ${e.purpose}.`, 'list');
    }
  }

  // ---- AI ------------------------------------------------------------------------

  private async summarize(d: PageDigest): Promise<void> {
    if (this.provider) return this.askModel('Summarize this page in a few sentences.', 'ask');
    // Offline fallback: extractive, clearly labelled.
    const paras = d.main.filter((b) => b.kind === 'paragraph' || b.kind === 'text').slice(0, 3);
    const firstSentences = paras.map((p) => (/^.*?[.!?](\s|$)/.exec(p.text)?.[0] ?? p.text).trim()).join(' ');
    await this.say(`No AI model is connected, so here is the start of the page rather than a summary.`);
    if (firstSentences) await this.say(firstSentences, 'content', 'page', d.lang || undefined);
    if (d.headings.length > 1) await this.say(`Its sections are: ${d.headings.slice(0, 8).map((h) => h.text).join(', ')}.`, 'list', 'page');
  }

  private askConsent(provider: ModelProvider, d: PageDigest): Promise<ConsentAnswer> {
    return new Promise((resolve) => {
      this.pendingConsent = { resolve };
      const cat = sensitiveCategory(d.url, d.title);
      const site = siteOf(d.url);
      const caution = cat ? ` This looks like a ${cat} site, which may show private information.` : '';
      void this.say(`To answer, I need to send part of this page from ${site} to ${provider.label}.${caution} Say "once", "always" for this site, or "never".`, 'confirm');
    });
  }

  private async askModel(input: string, forceMode?: AssistantMode): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      await this.say(this.terse ? "I don't know that command. Say help." : `I don't know the command "${input}". Say "help" to hear what I can do. If you connect your own AI model in Settings, you can also ask in your own words.`);
      return;
    }
    let d = await this.currentDigest();
    const decision = this.consent.check(d.origin, provider.isLocal);
    if (decision === 'deny') {
      await this.say(`You chose never to send ${siteOf(d.url)} to an AI model. Say "forget AI consent" to change that.`);
      return;
    }
    if (decision === 'ask') {
      const answer = await this.askConsent(provider, d);
      if (!answer) return void (await this.say('OK, nothing was sent.'));
      this.consent.set(d.origin, answer);
      if (answer === 'never') return void (await this.say(`Understood. I will never send ${siteOf(d.url)} to an AI model.`));
    }

    const mode: AssistantMode = forceMode ?? (isQuestion(input) ? 'ask' : 'act');
    const ctx: TaskContext = { userText: input, mode, startSite: siteOf(this.deps.backend.currentUrl()) };
    const controller = new AbortController();
    this.planner = controller;
    if (!this.terse) void this.say(mode === 'ask' ? 'Let me check.' : 'Working on it. Say "stop" to cancel.', 'hint');
    this.audit.record({ provider: provider.label, local: provider.isLocal, origin: d.origin, purpose: mode === 'ask' ? 'question' : 'task', chars: pageContext(d, input).length });

    // Origins the user has allowed for this task. If the model moves to a new
    // site, consent is checked again before any of that site is sent (review #4).
    const allowedOrigins = new Set<string>([d.origin]);
    const ensureConsent = async (): Promise<boolean> => {
      if (allowedOrigins.has(d.origin)) return true;
      const c = this.consent.check(d.origin, provider.isLocal);
      if (c === 'deny') return false;
      if (c === 'ask') {
        const answer = await this.askConsent(provider, d);
        if (!answer || answer === 'never') {
          if (answer === 'never') this.consent.set(d.origin, 'never');
          return false;
        }
        this.consent.set(d.origin, answer);
      }
      allowedOrigins.add(d.origin);
      return true;
    };
    const send = (text: string): string => {
      const out = redactText(text);
      this.audit.record({ provider: provider.label, local: provider.isLocal, origin: d.origin, purpose: 'tool result', chars: out.length });
      return out;
    };
    const notAllowed = () => `The user has not allowed sending ${siteOf(d.url)} to the AI. Stop and tell the user you could not read this site.`;

    const execute = async (call: ToolCall): Promise<string> => {
      if (controller.signal.aborted) return 'Cancelled by the user.';
      const a = call.arguments as Record<string, string | number | boolean | undefined>;
      const ref = String(a.ref ?? '');
      const readTool = ['get_outline', 'read_section', 'find_text', 'list_controls', 'describe'].includes(call.name);
      if (readTool && !(await ensureConsent())) return notAllowed();
      switch (call.name) {
        case 'get_outline':
          return send(pageContext(d, '', 3000));
        case 'read_section': {
          const i = d.main.findIndex((b) => b.ref === ref);
          const start = i >= 0 ? i : 0;
          return send(d.main.slice(start, start + Math.min(Number(a.count ?? 10), 30)).map((b) => `[${b.ref}] ${b.text}`).join('\n') || 'No text there.');
        }
        case 'find_text': {
          const hits = await this.deps.backend.findText(String(a.query ?? ''));
          return send(hits.length ? hits.map((h) => `[${h.ref}] ${h.text}`).join('\n') : 'Not found.');
        }
        case 'list_controls':
          return send(d.controls.map((c) => `[${c.ref}] ${this.describeControl(c)}`).join('\n') || 'No controls.');
        case 'describe':
          return send(await this.deps.backend.describe(ref));
      }
      // ---- Actions: policy, then safety gate, then do it. ----
      let planned: PlannedAction;
      switch (call.name) {
        case 'click': planned = { type: 'click', ref }; break;
        case 'type_text': planned = { type: 'type', ref, text: String(a.text ?? '') }; break;
        case 'choose_option': planned = { type: 'select', ref, option: String(a.option ?? '') }; break;
        case 'set_checkbox': planned = { type: 'check', ref, checked: a.checked === true || a.checked === 'true' }; break;
        case 'submit_form': planned = { type: 'submit', ref }; break;
        case 'navigate': planned = { type: 'navigate', url: String(a.url ?? '') }; break;
        case 'go_back': planned = { type: 'back' }; break;
        default: return `Unknown tool ${call.name}.`;
      }
      if (planned.type === 'navigate' && assessUrl(planned.url).dangerous) {
        await this.say(`I stopped the AI from opening ${speakableSite(siteOf(planned.url))}, which looks like a fake or dangerous site.`, 'alert');
        return 'Blocked by the browser: that address looks dangerous. Do not try it again.';
      }
      const policy = checkPolicy(planned, ctx, d);
      if (policy.kind === 'deny') {
        await this.say(`I stopped the AI: ${policy.reason}`, 'alert');
        return `Blocked by the browser: ${policy.reason}`;
      }
      if (policy.kind === 'confirm') {
        const ok = await this.confirm({ prompt: `${policy.reason} Allow it? Say "yes" or "no".`, risk: 'confirm' });
        if (!ok || controller.signal.aborted) return 'The user said no. Do not try this again; tell the user what you were trying to do.';
      }
      if (planned.type !== 'navigate' && planned.type !== 'back') {
        if (!(await this.gate(assessAction(planned, d), d, planned.ref))) return 'The user declined or the page changed; nothing was done.';
      }
      if (controller.signal.aborted) return 'Cancelled by the user.';
      const before = this.deps.backend.currentUrl();
      let ok = true;
      let message: string | undefined;
      if (planned.type === 'navigate') await this.deps.backend.navigate(planned.url);
      else if (planned.type === 'back') ok = await this.deps.backend.back();
      else ({ ok, message } = await this.deps.backend.act(planned));
      if (!ok) return `That failed: ${message ?? 'unknown error'}`;
      await this.say(this.describeStep(planned, d), 'info');
      d = await this.currentDigest(true);
      const moved = this.deps.backend.currentUrl() !== before;
      if (!(await ensureConsent())) return `Done. A new page loaded. ${notAllowed()}`;
      return send(`Done. ${moved ? 'A new page loaded. ' : ''}Page now: "${d.title}" (${d.kind}).${d.controls.some((c) => c.invalid) ? ' Some fields show errors.' : ''}`);
    };

    try {
      const result = await runPlanner({ provider, mode, question: input, digest: d, execute, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.refused) return void (await this.say('The AI model declined to help with this.', 'info', 'ai'));
      if (!result.answer) {
        await this.say(result.stoppedEarly ? 'The AI ran out of steps before finishing. Say what you want again, or try smaller steps.' : 'The AI gave no answer.', 'info');
        return;
      }
      await this.say(result.answer, 'info', 'ai');
      const v = verifyAgainstSource(result.answer, result.sourceText);
      if (v.unverified.length) {
        await this.say(`Please double-check: I couldn't find ${v.unverified.slice(0, 4).join(', ')} on the page.`, 'alert');
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      await this.say(`The AI request failed. ${(e as Error).message}`, 'error');
    } finally {
      if (this.planner === controller) this.planner = null;
    }
  }

  private describeStep(p: PlannedAction, d: PageDigest): string {
    const name = (ref: string) => d.controls.find((c) => c.ref === ref)?.name ?? d.links.find((l) => l.ref === ref)?.text ?? 'an item';
    switch (p.type) {
      case 'click': return `Pressed ${name(p.ref)}.`;
      case 'type': return d.controls.find((c) => c.ref === p.ref)?.sensitive ? `Filled ${name(p.ref)}.` : `Typed "${p.text}" into ${name(p.ref)}.`;
      case 'select': return `Chose ${p.option} in ${name(p.ref)}.`;
      case 'check': return `${p.checked ? 'Checked' : 'Unchecked'} ${name(p.ref)}.`;
      case 'submit': return 'Submitted the form.';
      case 'navigate': return `Opened ${siteOf(p.url)}.`;
      case 'back': return 'Went back.';
      default: return 'Done.';
    }
  }
}
