/**
 * The page agent: a self-contained function injected into every page.
 *
 * It MUST NOT reference anything outside its own body (no imports, no outer
 * variables, no runtime helpers) because backends serialise it with
 * `Function.prototype.toString()` and evaluate it in the page's isolated
 * world. Types are fine — they're erased.
 *
 * Installing it defines `window.__frontier` with `digest()`, `act()`,
 * `findText()` and `describe()`.
 */
import type {
  ActionResult,
  Block,
  BlockKind,
  ControlInfo,
  ControlKind,
  DigestOptions,
  ElementAction,
  Heading,
  ImageInfo,
  Landmark,
  LinkInfo,
  PageDigest,
  PageKind,
  PageWarning,
  SensitiveKind,
  TableInfo,
} from '../types.js';

export interface PageAgentApi {
  version: number;
  digest(options?: DigestOptions): PageDigest;
  act(action: ElementAction): ActionResult;
  findText(query: string): { ref: string; text: string }[];
  describe(ref: string): string;
  /** Elements for refs (null when gone). Used by backends to map refs to the AX tree. */
  elements(refs: string[]): (Element | null)[];
  /**
   * Scroll an element into view and return a point inside it that actually
   * hits it, or null if something covers it. Used for trusted input (AR-20).
   */
  clickPoint(ref: string): { x: number; y: number } | null;
  /** Clear a text field before trusted text insertion. */
  clear(ref: string): boolean;
}

export function installPageAgent(winArg?: Window): PageAgentApi {
  type AgentWindow = Window & typeof globalThis & { __frontier?: PageAgentApi };
  const win = (winArg ?? window) as AgentWindow;
  const AGENT_VERSION = 1;
  if (win.__frontier && win.__frontier.version === AGENT_VERSION) return win.__frontier;

  const doc = win.document;

  // ---- Stable refs -------------------------------------------------------
  // WeakMap so we never mutate the page's DOM (some sites break or detect it).
  const refOf = new WeakMap<Element, string>();
  const elOf = new Map<string, WeakRef<Element>>();
  let nextRef = 1;
  function ref(el: Element): string {
    let r = refOf.get(el);
    if (!r) {
      r = 'e' + nextRef++;
      refOf.set(el, r);
      elOf.set(r, new WeakRef(el));
    }
    return r;
  }
  function lookup(r: string): Element | null {
    const el = elOf.get(r)?.deref();
    if (!el || !el.isConnected) return null;
    return el;
  }

  // ---- Text helpers ------------------------------------------------------
  function clean(s: string | null | undefined): string {
    return (s ?? '').replace(/[\s ​]+/g, ' ').trim();
  }
  function clip(s: string, n: number): string {
    return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  }

  // ---- Visibility (the accessibility tree's notion, not the visual one) --
  // Screen-reader-only text (clipped, off-screen) is INCLUDED: it exists for
  // exactly our users. Only content removed from the accessibility tree is
  // excluded.
  const hiddenCache = new WeakMap<Element, boolean>();
  function isHidden(el: Element): boolean {
    const cached = hiddenCache.get(el);
    if (cached !== undefined) return cached;
    let hidden = false;
    if (
      el.hasAttribute('hidden') ||
      el.getAttribute('aria-hidden') === 'true' ||
      el.hasAttribute('inert')
    ) {
      hidden = true;
    } else {
      const tag = el.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') {
        hidden = true;
      } else if (tag === 'INPUT' && (el as HTMLInputElement).type === 'hidden') {
        hidden = true;
      } else {
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') {
          hidden = true;
        }
      }
    }
    if (!hidden) {
      const parent = parentOf(el);
      if (parent && parent.nodeType === 1) hidden = isHidden(parent as Element);
    }
    hiddenCache.set(el, hidden);
    return hidden;
  }
  function parentOf(el: Element): Element | null {
    if (el.parentElement) return el.parentElement;
    const root = el.parentNode;
    // Cross open shadow-root boundaries.
    if (root && (root as ShadowRoot).host) return (root as ShadowRoot).host;
    return null;
  }

  // ---- Roles -------------------------------------------------------------
  function roleOf(el: Element): string {
    const explicit = clean(el.getAttribute('role')).split(' ')[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'a':
      case 'area':
        return el.hasAttribute('href') ? 'link' : 'generic';
      case 'button':
        return 'button';
      case 'nav':
        return 'navigation';
      case 'main':
        return 'main';
      case 'aside':
        return 'complementary';
      case 'header':
        return insideSectioning(el) ? 'generic' : 'banner';
      case 'footer':
        return insideSectioning(el) ? 'generic' : 'contentinfo';
      case 'form':
        return hasOwnName(el) ? 'form' : 'generic';
      case 'section':
        return hasOwnName(el) ? 'region' : 'generic';
      case 'search':
        return 'search';
      case 'article':
        return 'article';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        return 'heading';
      case 'img':
        return el.getAttribute('alt') === '' ? 'presentation' : 'img';
      case 'select':
        return (el as HTMLSelectElement).multiple || (el as HTMLSelectElement).size > 1
          ? 'listbox'
          : 'combobox';
      case 'textarea':
        return 'textbox';
      case 'table':
        return 'table';
      case 'dialog':
        return 'dialog';
      case 'input': {
        const t = (el as HTMLInputElement).type;
        if (t === 'checkbox') return 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
        if (t === 'search') return 'searchbox';
        return 'textbox';
      }
      default:
        return 'generic';
    }
  }
  function insideSectioning(el: Element): boolean {
    let p = parentOf(el);
    while (p) {
      const t = p.tagName;
      if (t === 'ARTICLE' || t === 'ASIDE' || t === 'MAIN' || t === 'NAV' || t === 'SECTION') return true;
      p = parentOf(p);
    }
    return false;
  }
  function hasOwnName(el: Element): boolean {
    return !!(clean(el.getAttribute('aria-label')) || clean(el.getAttribute('aria-labelledby')));
  }

  // ---- Accessible name (essentials of accname-1.2) -----------------------
  const NAME_FROM_CONTENT = new Set([
    'button', 'link', 'heading', 'cell', 'columnheader', 'rowheader', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'treeitem', 'tooltip',
    'checkbox', 'radio', 'switch', 'gridcell', 'row', 'sectionhead',
  ]);

  function textAlternative(node: Node, visited: Set<Node>, fromContent: boolean): string {
    if (visited.has(node)) return '';
    visited.add(node);
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    if (isHidden(el)) return '';
    const label = clean(el.getAttribute('aria-label'));
    if (label) return label;
    const tag = el.tagName;
    if (tag === 'IMG' || (tag === 'INPUT' && (el as HTMLInputElement).type === 'image')) {
      return el.getAttribute('alt') ?? '';
    }
    if (tag === 'SVG' || tag === 'svg') {
      const title = el.querySelector('title');
      return title ? clean(title.textContent) : '';
    }
    if (fromContent && (tag === 'INPUT' || tag === 'TEXTAREA')) {
      return (el as HTMLInputElement).value ?? '';
    }
    if (fromContent && tag === 'SELECT') {
      const s = el as HTMLSelectElement;
      return s.selectedOptions[0]?.textContent ?? '';
    }
    let out = '';
    const children = el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes;
    for (const child of Array.from(children)) {
      const piece = textAlternative(child, visited, true);
      out += isInlineTag(child) ? piece : ' ' + piece + ' ';
    }
    return out;
  }
  function isInlineTag(n: Node): boolean {
    if (n.nodeType !== 1) return true;
    const t = (n as Element).tagName;
    return /^(A|ABBR|B|BDI|BDO|CITE|CODE|DFN|EM|I|KBD|MARK|Q|S|SAMP|SMALL|SPAN|STRONG|SUB|SUP|TIME|U|VAR|IMG|LABEL)$/.test(t);
  }
  function textOf(el: Element): string {
    return clean(textAlternative(el, new Set(), true));
  }
  function byIds(ids: string): string {
    return clean(
      ids
        .split(/\s+/)
        .map((id) => doc.getElementById(id))
        .filter((e): e is HTMLElement => !!e)
        .map((e) => textAlternative(e, new Set(), true))
        .join(' '),
    );
  }

  function accessibleName(el: Element): string {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const n = byIds(labelledby);
      if (n) return n;
    }
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'METER' || tag === 'PROGRESS') {
      const input = el as HTMLInputElement;
      const labels = input.labels ? Array.from(input.labels) : [];
      if (labels.length) {
        const n = clean(
          labels
            .map((l) => {
              // A wrapping label's name must not include the control's own value.
              const v = new Set<Node>([el]);
              return textAlternative(l, v, true);
            })
            .join(' '),
        );
        if (n) return n;
      }
      if (tag === 'INPUT') {
        const t = input.type;
        if (t === 'submit' || t === 'reset' || t === 'button') {
          return clean(input.value) || (t === 'submit' ? 'Submit' : t === 'reset' ? 'Reset' : '');
        }
        if (t === 'image') return clean(input.alt) || 'Submit';
      }
    }
    if (tag === 'IMG' || tag === 'AREA') {
      const alt = el.getAttribute('alt');
      if (alt !== null) return clean(alt);
    }
    if (tag === 'FIELDSET') {
      const legend = el.querySelector(':scope > legend');
      if (legend) return textOf(legend);
    }
    if (tag === 'TABLE') {
      const cap = (el as HTMLTableElement).caption;
      if (cap) return textOf(cap);
    }
    const role = roleOf(el);
    if (NAME_FROM_CONTENT.has(role)) {
      const n = textOf(el);
      if (n) return n;
    }
    const title = clean(el.getAttribute('title'));
    if (title) return title;
    const ph = clean(el.getAttribute('placeholder') ?? el.getAttribute('aria-placeholder'));
    if (ph) return ph;
    return '';
  }

  function description(el: Element): string {
    const ids = el.getAttribute('aria-describedby');
    return ids ? byIds(ids) : '';
  }

  // ---- Tree walk (light DOM + open shadow roots) -------------------------
  function* walk(root: Element | Document | ShadowRoot): Generator<Element> {
    const kids = Array.from(root.children);
    for (const el of kids) {
      if (el.tagName === 'HEAD') continue;
      if (isHidden(el)) {
        hiddenCount++;
        continue;
      }
      yield el;
      if (el.shadowRoot) yield* walk(el.shadowRoot);
      yield* walk(el);
    }
  }
  let hiddenCount = 0;

  // ---- Sensitive-field detection -----------------------------------------
  const SENSITIVE_PATTERNS: [RegExp, SensitiveKind][] = [
    [/card.?num|credit.?card|cc.?num|\bpan\b|cvv|cvc|csc|security.?code|expir/i, 'payment'],
    [/\bssn\b|social.?security|passport|national.?id|driver.?s?.?licen|tax.?id|\bitin\b|\bnino\b/i, 'government-id'],
    [/one.?time|\botp\b|verification.?code|2fa|two.?factor|auth.?code|passcode/i, 'otp'],
    [/routing|account.?number|\biban\b|sort.?code|\bbic\b|swift/i, 'bank'],
    [/password|\bpin\b|passphrase/i, 'password'],
  ];
  function sensitiveKind(el: Element, name: string): SensitiveKind | undefined {
    const input = el as HTMLInputElement;
    if (input.type === 'password') return 'password';
    const ac = (el.getAttribute('autocomplete') ?? '').toLowerCase();
    if (/cc-(number|csc|exp)/.test(ac)) return 'payment';
    if (ac.includes('one-time-code')) return 'otp';
    if (ac.includes('password')) return 'password';
    const hay = [name, el.getAttribute('name'), el.id, el.getAttribute('autocomplete')].join(' ');
    for (const [re, kind] of SENSITIVE_PATTERNS) if (re.test(hay)) return kind;
    return undefined;
  }

  function controlKind(el: Element, role: string): ControlKind | null {
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'textarea';
    if (tag === 'SELECT') return 'select';
    if (tag === 'BUTTON') return (el as HTMLButtonElement).type === 'submit' && (el as HTMLButtonElement).form ? 'submit' : 'button';
    if (tag === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      switch (t) {
        case 'checkbox': return 'checkbox';
        case 'radio': return 'radio';
        case 'range': return 'slider';
        case 'file': return 'file';
        case 'submit':
        case 'image': return 'submit';
        case 'button':
        case 'reset': return 'button';
        case 'search': return 'search';
        case 'email': return 'email';
        case 'password': return 'password';
        case 'number': return 'number';
        case 'tel': return 'tel';
        case 'url': return 'url';
        case 'date':
        case 'datetime-local':
        case 'month':
        case 'week':
        case 'time': return 'date';
        default: return 'textbox';
      }
    }
    if ((el as HTMLElement).isContentEditable && el.getAttribute('contenteditable') !== null) return 'textarea';
    switch (role) {
      case 'button': return 'button';
      case 'checkbox': return 'checkbox';
      case 'radio': return 'radio';
      case 'switch': return 'switch';
      case 'textbox': return 'textbox';
      case 'searchbox': return 'search';
      case 'combobox': return 'combobox';
      case 'slider': return 'slider';
      case 'menuitem':
      case 'tab': return 'button';
      default: return null;
    }
  }

  const BLOCK_TAGS: Record<string, BlockKind> = {
    P: 'paragraph', LI: 'list-item', BLOCKQUOTE: 'quote', PRE: 'code',
    FIGCAPTION: 'caption', DT: 'paragraph', DD: 'paragraph', H1: 'heading',
    H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
    TD: 'text', CAPTION: 'caption', ADDRESS: 'paragraph', SUMMARY: 'paragraph',
  };
  const CHROME_ROLES = new Set(['navigation', 'banner', 'contentinfo', 'complementary', 'search', 'dialog', 'alertdialog', 'menu', 'menubar', 'toolbar']);

  // ---- Main-content selection --------------------------------------------
  function linkDensity(el: Element): number {
    const total = clean(el.textContent).length || 1;
    let linkText = 0;
    el.querySelectorAll('a').forEach((a) => (linkText += clean(a.textContent).length));
    return linkText / total;
  }
  function pickMain(): Element {
    const mains = Array.from(doc.querySelectorAll('main, [role="main"]')).filter((e) => !isHidden(e));
    if (mains.length) return mains[0]!;
    const articles = Array.from(doc.querySelectorAll('article')).filter((e) => !isHidden(e));
    if (articles.length === 1) return articles[0]!;
    // Score containers by paragraph text, penalising link-heavy ones.
    let best: Element = doc.body ?? doc.documentElement;
    let bestScore = 0;
    const candidates = doc.querySelectorAll('div, section, article, td');
    candidates.forEach((c) => {
      if (isHidden(c)) return;
      let score = 0;
      c.querySelectorAll(':scope > p, :scope > div > p, :scope > h1, :scope > h2, :scope > ul > li').forEach((p) => {
        const len = clean(p.textContent).length;
        if (len > 25) score += Math.min(len, 1000) / 50 + 1;
      });
      score *= 1 - Math.min(linkDensity(c), 0.9);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    });
    return bestScore > 3 ? best : doc.body ?? doc.documentElement;
  }

  function inChrome(el: Element, mainRoot: Element): boolean {
    let p: Element | null = el;
    while (p && p !== mainRoot) {
      if (CHROME_ROLES.has(roleOf(p))) return true;
      p = parentOf(p);
    }
    return false;
  }

  function collectBlocks(root: Element, maxBlocks: number, maxChars: number): Block[] {
    const blocks: Block[] = [];
    const visit = (el: Element): void => {
      if (blocks.length >= maxBlocks) return;
      if (isHidden(el)) return;
      const role = roleOf(el);
      if (el !== root && CHROME_ROLES.has(role)) return;
      const tag = el.tagName;
      if (tag === 'LABEL' || tag === 'LEGEND' || tag === 'FORM' || tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SVG' || tag === 'svg' || tag === 'IFRAME') return;
      const kind = BLOCK_TAGS[tag] ?? (role === 'heading' ? 'heading' : undefined);
      // Lists of links inside main (e.g. "related articles") are kept; deeper
      // block children of an LI are read as part of the LI.
      if (kind) {
        if (kind === 'list-item' && el.querySelector('p, ul, ol')) {
          // Container-like list item; descend so nested items are separate.
        } else {
          // Reading text excludes the labels of buttons and fields inside the block.
          const controls = new Set<Node>(Array.from(el.querySelectorAll('button, input, select, textarea, [role="button"]')));
          const text = clean(textAlternative(el, controls, true));
          if (text) {
            const b: Block = { ref: ref(el), kind, text: clip(text, maxChars) };
            if (kind === 'heading') b.level = headingLevel(el);
            blocks.push(b);
          }
          return;
        }
      }
      // Div soup: an element with its own meaningful text is a block.
      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join(' ');
      if (clean(ownText).length > 1 && tag !== 'A') {
        const text = textOf(el);
        if (text) blocks.push({ ref: ref(el), kind: 'text', text: clip(text, maxChars) });
        return;
      }
      const kids = el.shadowRoot ? Array.from(el.shadowRoot.children) : Array.from(el.children);
      for (const k of kids) visit(k);
    };
    visit(root);
    return blocks;
  }

  function headingLevel(el: Element): number {
    const aria = parseInt(el.getAttribute('aria-level') ?? '', 10);
    if (aria > 0) return aria;
    const m = /^H([1-6])$/.exec(el.tagName);
    return m ? parseInt(m[1]!, 10) : 2;
  }

  // ---- Page kind ---------------------------------------------------------
  function classify(d: PageDigest, mainText: number): PageKind {
    const url = d.url.toLowerCase();
    const paragraphs = d.main.filter((b) => b.kind === 'paragraph').length;
    const fields = d.controls.filter((c) => !['button', 'submit', 'search'].includes(c.kind) && c.kind !== 'checkbox').length;
    const searchBox = d.controls.find((c) => c.kind === 'search' || /search/i.test(c.name));
    const mainLinks = d.links.filter((l) => l.inMain).length;
    const bodyText = clean(doc.body?.textContent).slice(0, 20000);
    if ((/[?&](q|query|search|k|p)=/.test(url) || /\/search\b/.test(url)) && searchBox && mainLinks >= 5) return 'search-results';
    if (/[$€£¥₹]\s?\d|\d[.,]\d{2}\s?(usd|eur|gbp)/i.test(bodyText) && d.controls.some((c) => /add to (cart|bag|basket)|buy now/i.test(c.name))) return 'product';
    if (doc.querySelector('article') && (mainText > 400 || paragraphs >= 3)) return 'article';
    if (paragraphs >= 4 && mainText > 1500) return 'article';
    if (fields >= 3 && mainText < 1500) return 'form';
    if (mainLinks >= 20 && mainText / Math.max(mainLinks, 1) < 80) return 'listing';
    if (d.controls.filter((c) => c.kind === 'button').length >= 8 && mainText < 800) return 'app';
    return 'page';
  }

  // ---- Digest ------------------------------------------------------------
  function digest(options: DigestOptions = {}): PageDigest {
    const maxLinks = options.maxLinks ?? 300;
    const maxControls = options.maxControls ?? 200;
    const maxBlocks = options.maxBlocks ?? 400;
    const maxHeadings = options.maxHeadings ?? 150;
    const maxBlockChars = options.maxBlockChars ?? 2000;
    hiddenCount = 0;

    const mainRoot = pickMain();
    const landmarks: Landmark[] = [];
    const headings: Heading[] = [];
    const links: LinkInfo[] = [];
    const controls: ControlInfo[] = [];
    const images: ImageInfo[] = [];
    const tables: TableInfo[] = [];
    const warnings: PageWarning[] = [];
    let truncated = false;
    const here = win.location;
    const radioGroupsSeen = new Set<string>();

    for (const el of walk(doc)) {
      const role = roleOf(el);
      const tag = el.tagName;
      if (['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'search', 'form', 'region'].includes(role)) {
        landmarks.push({ ref: ref(el), role, name: accessibleName(el) });
      }
      if (role === 'heading') {
        const text = textOf(el);
        if (text) {
          if (headings.length < maxHeadings) headings.push({ ref: ref(el), level: headingLevel(el), text: clip(text, 200) });
          else truncated = true;
        }
        continue;
      }
      if (role === 'link') {
        const href = (el as HTMLAnchorElement).href || el.getAttribute('href') || '';
        const text = accessibleName(el) || clip(href, 60);
        if (links.length < maxLinks) {
          let external = false;
          try {
            external = new URL(href, here.href).hostname !== here.hostname;
          } catch {
            external = false;
          }
          links.push({
            ref: ref(el),
            text: clip(text, 200),
            href,
            external,
            inMain: mainRoot.contains(el) && !inChrome(el, mainRoot),
          });
        } else truncated = true;
        // Links can contain images; fall through to image handling below.
      }
      if (tag === 'IMG' || role === 'img') {
        const alt = el.getAttribute('alt');
        const decorative = alt === '' || role === 'presentation' || role === 'none';
        if (!decorative || images.length < 50) {
          images.push({
            ref: ref(el),
            alt: alt === null ? (clean(el.getAttribute('aria-label')) || null) : clean(alt),
            decorative,
            src: (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || '',
            inMain: mainRoot.contains(el),
          });
        }
        continue;
      }
      if (tag === 'TABLE' && role === 'table') {
        const t = el as HTMLTableElement;
        const headerCells = Array.from(t.querySelectorAll('th')).slice(0, 12);
        tables.push({
          ref: ref(el),
          caption: t.caption ? textOf(t.caption) : accessibleName(el),
          rows: t.rows.length,
          cols: t.rows[0]?.cells.length ?? 0,
          headers: headerCells.map((h) => textOf(h)),
        });
      }
      const kind = role === 'link' ? null : controlKind(el, role);
      if (kind) {
        if (controls.length >= maxControls) {
          truncated = true;
          continue;
        }
        const input = el as HTMLInputElement;
        // Collapse radio groups into one entry per option, but warn once.
        if (kind === 'radio' && input.name) radioGroupsSeen.add(input.name);
        const name = accessibleName(el);
        const sensitive = kind === 'button' || kind === 'submit' ? undefined : sensitiveKind(el, name);
        const c: ControlInfo = {
          ref: ref(el),
          kind,
          name: clip(name, 200),
          required: input.required === true || el.getAttribute('aria-required') === 'true',
          invalid: el.getAttribute('aria-invalid') === 'true' || (typeof input.checkValidity === 'function' && input.value !== '' && !input.checkValidity()),
          disabled: input.disabled === true || el.getAttribute('aria-disabled') === 'true',
        };
        const desc = description(el);
        if (desc) c.description = clip(desc, 300);
        const errIds = el.getAttribute('aria-errormessage');
        if (errIds && c.invalid) c.error = byIds(errIds);
        if (kind === 'checkbox' || kind === 'radio' || kind === 'switch') {
          c.checked = tag === 'INPUT' ? input.checked : el.getAttribute('aria-checked') === 'true';
          if (tag === 'INPUT' && input.defaultChecked) c.prechecked = true;
        } else if (kind === 'select') {
          const s = el as HTMLSelectElement;
          c.options = Array.from(s.options).slice(0, 50).map((o) => clean(o.textContent));
          c.value = clean(s.selectedOptions[0]?.textContent);
        } else if (kind !== 'button' && kind !== 'submit') {
          const v = tag === 'INPUT' || tag === 'TEXTAREA' ? input.value : clean(el.textContent);
          if (sensitive) {
            c.sensitive = sensitive;
            c.hasValue = !!v;
          } else if (v) c.value = clip(v, 500);
        }
        const form = (input.form as HTMLFormElement | null | undefined) ?? el.closest('form');
        if (form) {
          c.form = ref(form);
          if (kind === 'submit' || kind === 'button') {
            c.formAction = (el as HTMLButtonElement).formAction || form.action || here.href;
          }
        }
        controls.push(c);
      }
    }

    // ---- Warnings ----
    if (doc.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')) {
      warnings.push({ kind: 'captcha', message: 'This page has a CAPTCHA. It may need an audio challenge or human help.' });
    }
    const optInRe = /newsletter|marketing|offers|promotion|subscribe|partners|third.?part|share my|insurance|protection plan|donat|tip|auto.?renew/i;
    for (const c of controls) {
      if (c.kind === 'checkbox' && c.prechecked && c.checked && optInRe.test(c.name)) {
        warnings.push({ kind: 'prechecked-optin', message: `The box "${c.name}" was already checked for you.`, ref: c.ref });
      }
    }
    if (here.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(here.hostname) && controls.some((c) => c.sensitive === 'password' || c.sensitive === 'payment')) {
      warnings.push({ kind: 'insecure-password', message: 'This page asks for a password or card details over an insecure connection.' });
    }
    const modal = Array.from(doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]')).find((e) => !isHidden(e));
    if (modal) {
      warnings.push({ kind: 'modal-open', message: `A dialog is open${accessibleName(modal) ? ': ' + accessibleName(modal) : ''}.`, ref: ref(modal) });
    }
    const bodyText = clean(doc.body?.textContent).slice(0, 30000);
    if (/(offer|sale|deal|price|reservation|cart)[^.]{0,40}(ends|expires|held) in|only \d+ left|\b\d{1,2}:\d{2}\b[^.]{0,20}(left|remaining)/i.test(bodyText)) {
      warnings.push({ kind: 'urgency-timer', message: 'This page uses a countdown or scarcity message to create urgency.' });
    }
    const scamSignals = [
      /(virus|infected|malware|hacked|trojan|spyware|suspicious activity|security alert|account (has been )?(locked|suspended))/i,
      /(call|phone|contact|toll.?free|helpline|support line)[^.]{0,60}(\+?\d[\d\s().-]{7,}\d)/i,
      /(do not (close|restart|turn off)|gift ?cards?|remote access|pay (with|in) (bitcoin|crypto))/i,
    ].filter((re) => re.test(bodyText)).length;
    if (scamSignals >= 2) {
      warnings.push({ kind: 'scam-suspected', message: 'Warning: this page looks like a tech-support or payment scam. Real companies do not ask you to call a number from a pop-up.' });
    }
    const unlabelled = controls.filter((c) => !c.name && c.kind !== 'radio').length;
    if (unlabelled > 0) {
      warnings.push({ kind: 'unlabelled-controls', message: `${unlabelled} control${unlabelled === 1 ? ' has' : 's have'} no label.` });
    }

    const main = collectBlocks(mainRoot, maxBlocks, maxBlockChars);
    if (main.length >= maxBlocks) truncated = true;
    const mainText = main.reduce((n, b) => n + b.text.length, 0);
    const meta = doc.querySelector('meta[name="description"], meta[property="og:description"]');
    const firstPara = main.find((b) => b.kind === 'paragraph' || b.kind === 'text');

    const d: PageDigest = {
      url: here.href,
      origin: here.origin,
      title: clean(doc.title) || headings[0]?.text || here.hostname,
      lang: doc.documentElement.lang || '',
      kind: 'page',
      landmarks,
      headings,
      links,
      controls,
      images,
      tables,
      main,
      description: clip(clean(meta?.getAttribute('content')) || firstPara?.text || '', 300),
      warnings,
      hiddenCount,
      truncated,
    };
    d.kind = classify(d, mainText);
    const active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement) d.focused = ref(active);
    return d;
  }

  // ---- Actions -----------------------------------------------------------
  function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    // Use the prototype setter so frameworks (React, Vue) notice the change.
    const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  function act(action: ElementAction): ActionResult {
    const el = lookup(action.ref);
    if (!el) return { ok: false, message: 'That item is no longer on the page.' };
    if (isHidden(el)) return { ok: false, message: 'That item is hidden right now.' };
    const h = el as HTMLElement;
    if ((h as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') {
      if (action.type !== 'focus' && action.type !== 'scroll') return { ok: false, message: 'That item is disabled.' };
    }
    try {
      h.scrollIntoView?.({ block: 'center' });
    } catch {
      /* jsdom / detached */
    }
    switch (action.type) {
      case 'scroll':
        return { ok: true };
      case 'focus':
        h.focus?.();
        return { ok: true };
      case 'click':
        h.focus?.();
        h.click();
        return { ok: true };
      case 'type': {
        h.focus?.();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const input = el as HTMLInputElement;
          const next = action.clear === false ? input.value + action.text : action.text;
          setNativeValue(input, next);
          return { ok: true };
        }
        if (h.isContentEditable) {
          h.textContent = action.clear === false ? (h.textContent ?? '') + action.text : action.text;
          h.dispatchEvent(new win.Event('input', { bubbles: true }));
          return { ok: true };
        }
        return { ok: false, message: "That isn't a text field." };
      }
      case 'select': {
        if (el.tagName !== 'SELECT') return { ok: false, message: "That isn't a list of choices." };
        const s = el as HTMLSelectElement;
        const want = action.option.toLowerCase().trim();
        const opts = Array.from(s.options);
        const match =
          opts.find((o) => clean(o.textContent).toLowerCase() === want || o.value.toLowerCase() === want) ??
          opts.find((o) => clean(o.textContent).toLowerCase().startsWith(want)) ??
          opts.find((o) => clean(o.textContent).toLowerCase().includes(want));
        if (!match) return { ok: false, message: `No option matching "${action.option}".` };
        s.value = match.value;
        s.dispatchEvent(new win.Event('input', { bubbles: true }));
        s.dispatchEvent(new win.Event('change', { bubbles: true }));
        return { ok: true, value: clean(match.textContent) };
      }
      case 'check': {
        const input = el as HTMLInputElement;
        const current = el.tagName === 'INPUT' ? input.checked : el.getAttribute('aria-checked') === 'true';
        if (current !== action.checked) h.click();
        return { ok: true };
      }
      case 'submit': {
        const form = el.tagName === 'FORM' ? (el as HTMLFormElement) : ((el as HTMLInputElement).form ?? el.closest('form'));
        if (!form) return { ok: false, message: 'There is no form to submit here.' };
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
        return { ok: true };
      }
    }
  }

  function findText(query: string): { ref: string; text: string }[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out: { ref: string; text: string }[] = [];
    for (const el of walk(doc)) {
      const tag = el.tagName;
      if (!(tag in BLOCK_TAGS) && !(roleOf(el) in { link: 1, button: 1 })) continue;
      const t = textOf(el);
      if (t.toLowerCase().includes(q)) {
        out.push({ ref: ref(el), text: clip(t, 300) });
        if (out.length >= 20) break;
      }
    }
    return out;
  }

  function describe(r: string): string {
    const el = lookup(r);
    if (!el) return 'That item is no longer on the page.';
    const role = roleOf(el);
    const name = accessibleName(el) || textOf(el);
    let ctx = '';
    let p = parentOf(el);
    while (p) {
      const pr = roleOf(p);
      if (['navigation', 'main', 'complementary', 'contentinfo', 'banner', 'form', 'region', 'dialog', 'article'].includes(pr)) {
        const n = accessibleName(p);
        ctx = ` in the ${pr === 'contentinfo' ? 'footer' : pr === 'banner' ? 'header' : pr}${n ? ' "' + n + '"' : ''}`;
        break;
      }
      p = parentOf(p);
    }
    return `${role === 'generic' ? '' : role + ' '}${clip(name, 200)}${ctx}`.trim();
  }

  function elements(refs: string[]): (Element | null)[] {
    return refs.map((r) => lookup(r));
  }

  function clickPoint(r: string): { x: number; y: number } | null {
    const el = lookup(r) as HTMLElement | null;
    if (!el || isHidden(el)) return null;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {
      /* ignore */
    }
    const rects = Array.from(el.getClientRects());
    for (const rect of rects) {
      if (rect.width < 1 || rect.height < 1) continue;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = doc.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) return { x, y };
    }
    return null;
  }

  function clear(r: string): boolean {
    const el = lookup(r);
    if (!el) return false;
    (el as HTMLElement).focus?.();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      setNativeValue(el as HTMLInputElement, '');
      return true;
    }
    if ((el as HTMLElement).isContentEditable) {
      el.textContent = '';
      return true;
    }
    return false;
  }

  const api: PageAgentApi = { version: AGENT_VERSION, digest, act, findText, describe, elements, clickPoint, clear };
  Object.defineProperty(win, '__frontier', { value: api, configurable: true, enumerable: false, writable: false });
  return api;
}
