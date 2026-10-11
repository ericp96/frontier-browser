/**
 * Privacy controls for anything sent to a model (AR-12).
 *
 * Defaults: nothing leaves the device unless an AI provider is configured;
 * local providers need no consent; cloud providers are default-deny on
 * sensitive sites and ask once per origin elsewhere.
 */
import type { Block, PageDigest } from '../types.js';
import { isPrivateHost } from '../safety/url-safety.js';

export type SensitiveCategory = 'banking' | 'health' | 'email' | 'government' | 'adult';

const CATEGORY_PATTERNS: [SensitiveCategory, RegExp, RegExp][] = [
  // [category, hostname pattern, title pattern]
  ['banking', /bank|chase\.|wellsfargo|citi\.|capitalone|paypal|venmo|zelle|cashapp|coinbase|schwab|fidelity|vanguard|creditunion|\bcu\.|amex|americanexpress|barclays|hsbc|lloyds|natwest|santander|revolut|monzo|wise\.com/i, /\b(online banking|account balance|statement|transfer funds|credit union|brokerage)\b/i],
  ['health', /health|mychart|patient|clinic|hospital|pharma|medic|kaiser|nhs\.uk|webmd|teladoc|cvs\.com|walgreens|labcorp|questdiagnostics/i, /\b(patient portal|lab results|prescription|diagnosis|medical record|appointment)\b/i],
  ['email', /^(mail|webmail|outlook|inbox)\.|gmail\.com|outlook\.live|proton\.me|protonmail|fastmail|yahoo\.com\/mail|mail\.yahoo|icloud\.com\/mail/i, /\b(inbox|compose|webmail)\b/i],
  ['government', /\.gov(\.[a-z]{2})?$|\.gouv\.|\.gob\.|\.gc\.ca$|\.mil$|irs\.|ssa\.|medicare\.|hmrc|dvla/i, /\b(social security|tax return|benefits account)\b/i],
  ['adult', /porn|xxx|xvideos|onlyfans|xhamster|redtube|youporn|chaturbate/i, /(?!)/],
];

export function sensitiveCategory(url: string, title = ''): SensitiveCategory | null {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [cat, hostRe, titleRe] of CATEGORY_PATTERNS) {
    if (hostRe.test(host) || hostRe.test(url) || titleRe.test(title)) return cat;
  }
  return null;
}

/** A model endpoint that never leaves this machine or local network. */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    return isPrivateHost(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

export type ConsentDecision = 'always' | 'never';
export type ConsentResult = 'allow' | 'ask' | 'deny';

/** Per-origin "may I send this site to your cloud AI?" decisions. */
export class ConsentStore {
  private decisions = new Map<string, ConsentDecision>();
  /** Origins allowed for the current page view only ("just this once"). */
  private once = new Set<string>();

  constructor(initial: Record<string, ConsentDecision> = {}) {
    for (const [k, v] of Object.entries(initial)) this.decisions.set(k, v);
  }

  check(origin: string, providerIsLocal: boolean): ConsentResult {
    const d = this.decisions.get(origin);
    if (d === 'never') return 'deny';
    if (providerIsLocal) return 'allow';
    if (d === 'always' || this.once.has(origin)) return 'allow';
    // Cloud providers: ask once per origin. There is deliberately no global
    // "always send everything" switch.
    return 'ask';
  }

  set(origin: string, decision: ConsentDecision | 'once'): void {
    if (decision === 'once') this.once.add(origin);
    else this.decisions.set(origin, decision);
  }

  forget(origin: string): void {
    this.decisions.delete(origin);
    this.once.delete(origin);
  }

  clearOnce(): void {
    this.once.clear();
  }

  toJSON(): Record<string, ConsentDecision> {
    return Object.fromEntries(this.decisions);
  }
}

// ---- Redaction ------------------------------------------------------------

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** Remove secrets that appear in page text before it leaves the device. */
export function redactText(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhnValid(m.replace(/\D/g, '')) ? '[card number removed]' : m))
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ID number removed]')
    .replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, '[bank account removed]')
    .replace(/\b((?:code|otp|passcode|pin|verification)\D{0,20})(\d{4,8})\b/gi, '$1[code removed]')
    .replace(/\b(password|passwd|pwd)(\s*[:=]\s*)\S+/gi, '$1$2[removed]');
}

// ---- Minimal context selection -----------------------------------------------

const STOP = new Set('a an the of to in on for and or is are was were be what which who how why when where does do did this that it page me my i you about tell can could please there any'.split(' '));

function terms(s: string): string[] {
  return s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Pick the blocks most relevant to the question, in reading order, within a
 * character budget. Sends the minimum rather than the whole page (AR-12).
 */
export function selectRelevantBlocks(blocks: Block[], question: string, budgetChars: number): Block[] {
  const total = blocks.reduce((n, b) => n + b.text.length, 0);
  if (total <= budgetChars) return blocks;
  const q = new Set(terms(question));
  const generic = q.size === 0 || /\b(summar|overview|about|gist|main point|tl;?dr)/i.test(question);
  const scored = blocks.map((b, i) => {
    let score = 0;
    if (!generic) for (const t of terms(b.text)) if (q.has(t)) score += 1;
    if (b.kind === 'heading') score += 0.5;
    // Generic questions favour the start of the content.
    score += generic ? Math.max(0, 3 - i / 10) : 0;
    return { b, i, score };
  });
  const picked = new Set<number>();
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + s.b.text.length > budgetChars) continue;
    picked.add(s.i);
    used += s.b.text.length;
  }
  return blocks.filter((_, i) => picked.has(i));
}

// ---- Audit log ------------------------------------------------------------------

export interface AuditEntry {
  time: string;
  provider: string;
  local: boolean;
  origin: string;
  purpose: string;
  chars: number;
}

/** "What did you send?" — bounded, so it doesn't become a data hoard (AR-12). */
export class AuditLog {
  private entries: AuditEntry[] = [];
  constructor(private readonly max = 200) {}

  record(e: Omit<AuditEntry, 'time'>, now = new Date()): void {
    this.entries.push({ ...e, time: now.toISOString() });
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
  }

  recent(n = 5): AuditEntry[] {
    return this.entries.slice(-n);
  }

  clear(): void {
    this.entries = [];
  }

  all(): readonly AuditEntry[] {
    return this.entries;
  }
}

export function digestTextForModel(d: PageDigest): string {
  return d.main.map((b) => b.text).join('\n');
}
