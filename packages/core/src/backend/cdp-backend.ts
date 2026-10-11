/**
 * A BrowserBackend built on the Chrome DevTools Protocol. The same code
 * drives Electron (webContents.debugger), Playwright/Chromium (CDPSession),
 * and a future native Chromium fork.
 *
 *  - The page agent runs in an ISOLATED WORLD: the page can't see it, detect
 *    it, or tamper with its prototypes (AR-5).
 *  - The digest is reconciled against Chromium's own accessibility tree, so
 *    the assistant uses the same names the user's screen reader does (AR-6).
 *  - Clicks and typing use trusted input events in the user's visible
 *    session, not synthetic DOM events (AR-20).
 */
import { installPageAgent } from '../page-agent/page-agent.js';
import type { ActionResult, DigestOptions, ElementAction, PageDigest } from '../types.js';
import type { BrowserBackend } from './backend.js';

/** Minimal CDP transport. Playwright's CDPSession satisfies it directly. */
export interface CdpTransport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface EvalResult {
  result: { value?: unknown; objectId?: string; type: string; subtype?: string };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

interface AXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
}

export interface Reconciliation {
  checked: number;
  /** Elements where our JS name differed from Chromium's (Chromium's wins). */
  disagreements: { ref: string; ours: string; chromium: string }[];
}

const WORLD = 'frontier-agent';
const AGENT_SOURCE = `(${installPageAgent.toString()})()`;

export class CdpBackend implements BrowserBackend {
  private contextId: number | null = null;
  private mainFrameId = '';
  private url = 'about:blank';
  private loadListeners = new Set<() => void>();
  private dialogListeners = new Set<(d: { type: string; message: string }) => void>();
  private loadWaiters: (() => void)[] = [];
  private initialized = false;
  /** Diagnostics from the most recent AX reconciliation. */
  lastReconciliation: Reconciliation = { checked: 0, disagreements: [] };

  constructor(
    private readonly cdp: CdpTransport,
    private readonly opts: { navigationTimeoutMs?: number; reconcileWithAxTree?: boolean } = {},
  ) {}

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.cdp.on('Page.frameNavigated', (p: { frame: { id: string; parentId?: string; url: string; urlFragment?: string } }) => {
      if (p.frame.parentId) return;
      this.mainFrameId = p.frame.id;
      this.url = p.frame.url + (p.frame.urlFragment ?? '');
      this.contextId = null;
    });
    this.cdp.on('Page.navigatedWithinDocument', (p: { frameId: string; url: string }) => {
      if (p.frameId !== this.mainFrameId) return;
      this.url = p.url;
      // SPA route change: treat as a new page for narration.
      this.emitLoaded();
    });
    this.cdp.on('Page.loadEventFired', () => {
      const waiters = this.loadWaiters.splice(0);
      for (const w of waiters) w();
      this.emitLoaded();
    });
    this.cdp.on('Runtime.executionContextsCleared', () => {
      this.contextId = null;
    });
    this.cdp.on('Page.javascriptDialogOpening', (p: { type: string; message: string }) => {
      // Pages can't trap the user with dialogs or block leaving (AR-11).
      // alert → accept; beforeunload → leave; confirm/prompt → dismiss and tell the user.
      const accept = p.type === 'alert' || p.type === 'beforeunload';
      void this.cdp.send('Page.handleJavaScriptDialog', { accept }).catch(() => undefined);
      if (p.type !== 'beforeunload') for (const l of this.dialogListeners) l({ type: p.type, message: p.message });
    });
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
    await this.cdp.send('DOM.enable').catch(() => undefined);
    await this.cdp.send('Accessibility.enable').catch(() => undefined);
    const tree = (await this.cdp.send('Page.getFrameTree')) as { frameTree: { frame: { id: string; url: string } } };
    this.mainFrameId = tree.frameTree.frame.id;
    this.url = tree.frameTree.frame.url;
  }

  private emitLoaded(): void {
    for (const l of this.loadListeners) l();
  }

  onPageLoaded(listener: () => void): () => void {
    this.loadListeners.add(listener);
    return () => this.loadListeners.delete(listener);
  }

  onDialog(listener: (d: { type: string; message: string }) => void): () => void {
    this.dialogListeners.add(listener);
    return () => this.dialogListeners.delete(listener);
  }

  currentUrl(): string {
    return this.url;
  }

  private waitForLoad(): Promise<void> {
    const timeout = this.opts.navigationTimeoutMs ?? 20000;
    return new Promise((resolve) => {
      const t = setTimeout(done, timeout);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.loadWaiters.push(done);
    });
  }

  async navigate(url: string): Promise<void> {
    await this.init();
    const loaded = this.waitForLoad();
    const res = (await this.cdp.send('Page.navigate', { url })) as { errorText?: string };
    if (res.errorText) {
      throw new Error(friendlyNetError(res.errorText));
    }
    await loaded;
  }

  private async historyMove(delta: number): Promise<boolean> {
    await this.init();
    const h = (await this.cdp.send('Page.getNavigationHistory')) as { currentIndex: number; entries: { id: number }[] };
    const entry = h.entries[h.currentIndex + delta];
    if (!entry) return false;
    const loaded = this.waitForLoad();
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    await loaded;
    return true;
  }

  back(): Promise<boolean> {
    return this.historyMove(-1);
  }

  forward(): Promise<boolean> {
    return this.historyMove(1);
  }

  async reload(): Promise<void> {
    await this.init();
    const loaded = this.waitForLoad();
    await this.cdp.send('Page.reload');
    await loaded;
  }

  // ---- Isolated world --------------------------------------------------------

  private async ensureWorld(): Promise<number> {
    await this.init();
    if (this.contextId !== null) return this.contextId;
    const w = (await this.cdp.send('Page.createIsolatedWorld', { frameId: this.mainFrameId, worldName: WORLD, grantUniveralAccess: false })) as { executionContextId: number };
    const r = (await this.cdp.send('Runtime.evaluate', { expression: AGENT_SOURCE + ', true', contextId: w.executionContextId, returnByValue: true })) as EvalResult;
    if (r.exceptionDetails) throw new Error(`Page agent failed to start: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    this.contextId = w.executionContextId;
    return this.contextId;
  }

  private async evaluate<T>(expression: string, returnByValue = true, retried = false): Promise<{ value: T; objectId?: string }> {
    const contextId = await this.ensureWorld();
    let r: EvalResult;
    try {
      r = (await this.cdp.send('Runtime.evaluate', { expression, contextId, returnByValue, awaitPromise: true })) as EvalResult;
    } catch (e) {
      // The document changed under us; rebuild the world once.
      if (!retried) {
        this.contextId = null;
        return this.evaluate(expression, returnByValue, true);
      }
      throw e;
    }
    if (r.exceptionDetails) {
      if (!retried && /__frontier|not defined|Cannot find context/.test(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)) {
        this.contextId = null;
        return this.evaluate(expression, returnByValue, true);
      }
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return { value: r.result.value as T, objectId: r.result.objectId };
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    return this.evaluate<T>(`window.__frontier.${method}(${args.map((a) => JSON.stringify(a)).join(',')})`).then((r) => r.value);
  }

  async digest(options?: DigestOptions): Promise<PageDigest> {
    const d = await this.call<PageDigest>('digest', options ?? {});
    // Trust the browser's committed URL over anything computed in the page.
    d.url = this.url;
    try {
      d.origin = new URL(this.url).origin;
    } catch {
      /* about: pages */
    }
    if (this.opts.reconcileWithAxTree !== false) await this.reconcile(d).catch(() => undefined);
    return d;
  }

  /** Overwrite names with Chromium's accessibility-tree names (AR-6). */
  private async reconcile(d: PageDigest): Promise<void> {
    const targets: { ref: string; get: () => string; set: (v: string) => void }[] = [];
    for (const c of d.controls) targets.push({ ref: c.ref, get: () => c.name, set: (v) => (c.name = v) });
    for (const l of d.links) targets.push({ ref: l.ref, get: () => l.text, set: (v) => (l.text = v) });
    for (const h of d.headings) targets.push({ ref: h.ref, get: () => h.text, set: (v) => (h.text = v) });
    const subset = targets.slice(0, 400);
    if (!subset.length) {
      this.lastReconciliation = { checked: 0, disagreements: [] };
      return;
    }
    const arr = await this.evaluate<unknown>(`window.__frontier.elements(${JSON.stringify(subset.map((t) => t.ref))})`, false);
    if (!arr.objectId) return;
    const props = (await this.cdp.send('Runtime.getProperties', { objectId: arr.objectId, ownProperties: true })) as {
      result: { name: string; value?: { objectId?: string } }[];
    };
    const backendIds = new Map<number, number>(); // index → backendNodeId
    await Promise.all(
      props.result.map(async (p) => {
        const idx = Number(p.name);
        if (!Number.isInteger(idx) || !p.value?.objectId) return;
        const n = (await this.cdp.send('DOM.describeNode', { objectId: p.value.objectId })) as { node: { backendNodeId: number } };
        backendIds.set(idx, n.node.backendNodeId);
      }),
    );
    void this.cdp.send('Runtime.releaseObject', { objectId: arr.objectId }).catch(() => undefined);
    const ax = (await this.cdp.send('Accessibility.getFullAXTree', {})) as { nodes: AXNode[] };
    const axByBackend = new Map<number, AXNode>();
    for (const n of ax.nodes) if (n.backendDOMNodeId !== undefined) axByBackend.set(n.backendDOMNodeId, n);
    const disagreements: Reconciliation['disagreements'] = [];
    let checked = 0;
    subset.forEach((t, i) => {
      const id = backendIds.get(i);
      const node = id === undefined ? undefined : axByBackend.get(id);
      if (!node || node.ignored) return;
      checked++;
      const chromium = (node.name?.value ?? '').replace(/\s+/g, ' ').trim();
      const ours = t.get();
      if (chromium && chromium !== ours) {
        disagreements.push({ ref: t.ref, ours, chromium });
        t.set(chromium);
      }
    });
    this.lastReconciliation = { checked, disagreements };
  }

  // ---- Actions ---------------------------------------------------------------

  async act(action: ElementAction): Promise<ActionResult> {
    if (action.type === 'click') {
      const pt = await this.call<{ x: number; y: number } | null>('clickPoint', action.ref);
      if (pt) {
        // Trusted input in the visible session (AR-20).
        const base = { x: pt.x, y: pt.y, button: 'left', clickCount: 1 };
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
        return { ok: true };
      }
      // Covered by an overlay or not hit-testable: fall back to a DOM click.
      return this.call<ActionResult>('act', action);
    }
    if (action.type === 'type') {
      if (action.clear !== false) {
        const cleared = await this.call<boolean>('clear', action.ref);
        if (!cleared) return this.call<ActionResult>('act', action);
      } else {
        await this.call<ActionResult>('act', { type: 'focus', ref: action.ref });
      }
      await this.cdp.send('Input.insertText', { text: action.text });
      return { ok: true };
    }
    return this.call<ActionResult>('act', action);
  }

  findText(query: string): Promise<{ ref: string; text: string }[]> {
    return this.call('findText', query);
  }

  describe(ref: string): Promise<string> {
    return this.call('describe', ref);
  }
}

function friendlyNetError(code: string): string {
  if (/NAME_NOT_RESOLVED/.test(code)) return "I couldn't find that website. Check the address, or say \"search for\" instead.";
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED/.test(code)) return 'You seem to be offline.';
  if (/CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|TIMED_OUT/.test(code)) return "The website didn't respond. Try again in a moment.";
  if (/CERT|SSL/.test(code)) return "This website's security certificate is not valid, so I did not open it. It may be an imposter.";
  if (/BLOCKED/.test(code)) return 'That address is blocked for your safety.';
  return `The page couldn't be opened (${code}).`;
}
