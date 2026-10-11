import { JSDOM } from 'jsdom';
import { installPageAgent, type PageAgentApi } from '../../src/page-agent/page-agent.js';
import type { BrowserBackend } from '../../src/backend/backend.js';
import type { ActionResult, DigestOptions, ElementAction, PageDigest } from '../../src/types.js';

/** An in-memory browser over jsdom, for fast assistant tests. */
export class FakeBackend implements BrowserBackend {
  dom: JSDOM | null = null;
  agent: PageAgentApi | null = null;
  history: string[] = [];
  index = -1;
  actions: ElementAction[] = [];
  navigations: string[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly pages: Record<string, string>) {}

  private load(url: string): void {
    const html = this.pages[url] ?? (url === 'about:blank' ? '<title>about:blank</title>' : '<title>Not found</title><h1>Not found</h1>');
    this.dom = new JSDOM(html, { url: url === 'about:blank' ? 'about:blank' : url });
    // Forms submit in-page in tests.
    this.dom.window.document.addEventListener('submit', (e) => e.preventDefault(), true);
    this.agent = installPageAgent(this.dom.window as unknown as Window);
  }

  async navigate(url: string): Promise<void> {
    this.navigations.push(url);
    this.history = this.history.slice(0, this.index + 1);
    this.history.push(url);
    this.index++;
    this.load(url);
    await this.emit();
  }

  /** Wait for all listeners (e.g. the assistant's narration) to finish. */
  private async emit(): Promise<void> {
    for (const l of this.listeners) l();
    await new Promise((r) => setTimeout(r, 0));
  }

  currentUrl(): string {
    return this.history[this.index] ?? 'about:blank';
  }

  async back(): Promise<boolean> {
    if (this.index <= 0) return false;
    this.index--;
    this.load(this.currentUrl());
    await this.emit();
    return true;
  }

  async forward(): Promise<boolean> {
    if (this.index >= this.history.length - 1) return false;
    this.index++;
    this.load(this.currentUrl());
    await this.emit();
    return true;
  }

  async reload(): Promise<void> {
    this.load(this.currentUrl());
    await this.emit();
  }

  async digest(options?: DigestOptions): Promise<PageDigest> {
    if (!this.agent) this.load('about:blank');
    return { ...this.agent!.digest(options), url: this.currentUrl() };
  }

  async act(action: ElementAction): Promise<ActionResult> {
    this.actions.push(action);
    // jsdom doesn't navigate on link clicks; emulate it for known pages.
    if (action.type === 'click') {
      const el = this.agent!.elements([action.ref])[0] as HTMLAnchorElement | null;
      if (el?.tagName === 'A' && el.href && this.pages[el.href]) {
        await this.navigate(el.href);
        return { ok: true };
      }
    }
    return this.agent!.act(action);
  }

  async findText(q: string) {
    return this.agent!.findText(q);
  }

  async describe(ref: string) {
    return this.agent!.describe(ref);
  }

  onPageLoaded(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** Let queued microtasks/announcements settle. */
export const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
