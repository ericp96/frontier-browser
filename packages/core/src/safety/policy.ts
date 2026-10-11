/**
 * Capability policy for model-planned actions (AR-2).
 *
 * Every argument a model produces is influenced by the page, so provenance
 * can't be traced through the model. Instead, deterministic rules decide what
 * a model may do on its own, using only facts the browser controls: the
 * user's own words, the committed URL, and the page digest.
 */
import type { ElementAction, PageDigest } from '../types.js';
import { registrableDomain, siteOf } from './url-safety.js';

export type AssistantMode = 'ask' | 'act';

export interface TaskContext {
  /** The user's request, verbatim (typed or transcribed). */
  userText: string;
  mode: AssistantMode;
  /** Site the task started on. */
  startSite: string;
}

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'confirm'; reason: string };

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s ]+/g, ' ').trim();
}

/** Did the user name this site in their request? ("go to bbc", "on amazon.co.uk") */
export function userNamedSite(userText: string, site: string): boolean {
  const t = norm(userText);
  if (!site) return false;
  if (t.includes(site)) return true;
  const label = site.split('.')[0] ?? '';
  return label.length >= 3 && new RegExp(`\\b${label.replace(/[^a-z0-9-]/g, '')}\\b`).test(t);
}

/** Did this exact text come from the user, rather than from the page? */
export function textFromUser(userText: string, text: string): boolean {
  const t = norm(text);
  if (!t) return true;
  const u = norm(userText);
  if (u.includes(t)) return true;
  // Allow dictation normalisation ("john dot smith at x dot com" → "john.smith@x.com").
  const squash = (s: string) => s.replace(/\bdot\b/g, '.').replace(/\bat\b/g, '@').replace(/[\s]/g, '');
  return squash(u).includes(squash(t));
}

export type PlannedAction = ElementAction | { type: 'navigate'; url: string } | { type: 'back' };

export const READ_ONLY_TOOLS = new Set(['get_outline', 'read_section', 'find_text', 'list_controls', 'describe']);

export function checkPolicy(action: PlannedAction, ctx: TaskContext, digest: PageDigest): PolicyDecision {
  if (ctx.mode === 'ask') {
    return { kind: 'deny', reason: 'The assistant was only asked a question, so it is not allowed to change anything on the page.' };
  }
  if (action.type === 'back') return { kind: 'allow' };

  if (action.type === 'navigate') {
    let site: string;
    try {
      const u = new URL(action.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'deny', reason: `The assistant tried to open a ${u.protocol} address, which is not allowed.` };
      site = registrableDomain(u.hostname);
    } catch {
      return { kind: 'deny', reason: 'The assistant produced an invalid web address.' };
    }
    if (site === ctx.startSite || site === siteOf(digest.url) || userNamedSite(ctx.userText, site)) return { kind: 'allow' };
    return { kind: 'confirm', reason: `The assistant wants to open a different site, ${site}, that you didn't mention.` };
  }

  if (action.type === 'click') {
    const link = digest.links.find((l) => l.ref === action.ref);
    if (link?.external) {
      const site = siteOf(link.href);
      if (site && !userNamedSite(ctx.userText, site)) {
        return { kind: 'confirm', reason: `That link goes to another site, ${site}, that you didn't mention.` };
      }
    }
    return { kind: 'allow' };
  }

  if (action.type === 'type') {
    const control = digest.controls.find((c) => c.ref === action.ref);
    if (control?.sensitive) {
      // Models never type secrets. The user must provide them directly.
      return { kind: 'deny', reason: `The assistant may not fill in your ${control.sensitive.replace('-', ' ')}. Please type it yourself.` };
    }
    if (!textFromUser(ctx.userText, action.text)) {
      return { kind: 'confirm', reason: `The assistant wants to type "${action.text}" into ${control?.name || 'a field'}, but you didn't say that text.` };
    }
    return { kind: 'allow' };
  }

  if (action.type === 'select') {
    if (!textFromUser(ctx.userText, action.option)) {
      const control = digest.controls.find((c) => c.ref === action.ref);
      return { kind: 'confirm', reason: `The assistant wants to choose "${action.option}" in ${control?.name || 'a list'}.` };
    }
    return { kind: 'allow' };
  }

  return { kind: 'allow' };
}
