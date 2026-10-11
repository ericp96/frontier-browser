/**
 * The safety gate. It decides, deterministically and outside any model,
 * whether an action needs the user's explicit confirmation, and it builds the
 * confirmation text from browser-verified facts (AR-2, AR-3).
 */
import type { ControlInfo, ElementAction, LinkInfo, PageDigest } from '../types.js';
import { siteOf, speakableSite } from './url-safety.js';
import { quoteUntrusted } from './policy.js';

export type Risk = 'none' | 'confirm' | 'high';

const HIGH_RISK = /\b(pay|payment|place (your )?order|complete (purchase|order)|buy now|purchase|confirm (and )?pay|transfer|send money|wire|withdraw|delete (my |your )?(account|profile)|close (my |your )?account|permanently delete|donate|tip\b|subscribe and pay|start (free )?trial|authori[sz]e payment|checkout and pay)\b/i;
const CONFIRM = /\b(submit|send|post|publish|tweet|reply|comment|sign ?up|register|apply|book|reserve|order|check ?out|save|delete|remove|discard|subscribe|unsubscribe|cancel (my )?(subscription|order|membership|booking)|accept|agree|share|invite|follow|upload|request|join|vote|rate|review|log ?out|sign ?out|confirm|approve|grant|allow)\b/i;
const CHECKOUT_URL = /checkout|cart|basket|payment|billing|order|purchase|pay\b/i;
const CONTINUE = /^(continue|next|proceed|go|ok|done|finish)\b/i;

export interface RiskAssessment {
  risk: Risk;
  /** Short human description of what will happen. */
  what: string;
  /** Extra trusted fact to announce, e.g. a cross-site form target. */
  note?: string;
}

function formHasSensitive(digest: PageDigest, formRef: string | undefined): boolean {
  if (!formRef) return false;
  return digest.controls.some((c) => c.form === formRef && (c.sensitive === 'payment' || c.sensitive === 'bank'));
}

function isSearchOnlyForm(digest: PageDigest, formRef: string | undefined): boolean {
  if (!formRef) return false;
  const fields = digest.controls.filter((c) => c.form === formRef && c.kind !== 'button' && c.kind !== 'submit');
  return fields.length > 0 && fields.every((c) => c.kind === 'search' || /search|query|find/i.test(c.name));
}

/** A form that posts to a different site than the page is a classic data-harvesting trick. */
function crossSiteNote(digest: PageDigest, formAction: string | undefined): string {
  if (!formAction) return '';
  const target = siteOf(formAction);
  const here = siteOf(digest.url);
  return target && here && target !== here ? `Warning: this form sends your information to a different site, ${speakableSite(target)}.` : '';
}

export function assessAction(action: ElementAction, digest: PageDigest): RiskAssessment {
  const r = assessActionInner(action, digest);
  const control = digest.controls.find((c) => c.ref === action.ref);
  const submitter = action.type === 'submit' ? digest.controls.find((c) => c.form === (control?.form ?? action.ref) && c.kind === 'submit') : control;
  const note = r.risk === 'none' && action.type !== 'submit' ? '' : crossSiteNote(digest, submitter?.formAction);
  return note ? { risk: r.risk === 'none' ? 'confirm' : r.risk, what: r.what, note } : r;
}

function assessActionInner(action: ElementAction, digest: PageDigest): RiskAssessment {
  const control: ControlInfo | undefined = digest.controls.find((c) => c.ref === action.ref);
  const link: LinkInfo | undefined = digest.links.find((l) => l.ref === action.ref);
  const onCheckout = CHECKOUT_URL.test(digest.url) || digest.controls.some((c) => c.sensitive === 'payment');

  if (action.type === 'submit') {
    const formRef = control?.form ?? action.ref;
    if (isSearchOnlyForm(digest, formRef)) return { risk: 'none', what: 'search' };
    const submitBtn = digest.controls.find((c) => c.form === formRef && c.kind === 'submit');
    const label = quoteUntrusted(submitBtn?.name ?? 'the form');
    if (formHasSensitive(digest, formRef) || HIGH_RISK.test(label)) return { risk: 'high', what: `submit "${label}"` };
    return { risk: 'confirm', what: `submit "${label}"` };
  }

  if (action.type === 'click') {
    const name = quoteUntrusted(control?.name ?? link?.text ?? '');
    if (control && (control.kind === 'submit' || control.kind === 'button')) {
      if (control.kind === 'submit' && isSearchOnlyForm(digest, control.form)) return { risk: 'none', what: `press "${name}"` };
      if (HIGH_RISK.test(name)) return { risk: 'high', what: `press "${name}"` };
      if (CONFIRM.test(name)) return { risk: 'confirm', what: `press "${name}"` };
      // On a checkout page ANY button can complete a purchase: "Continue",
      // "Buy", "Renew", or an unlabelled one (AR-3, review).
      if (onCheckout) return { risk: formHasSensitive(digest, control.form) || CONTINUE.test(name) ? 'high' : 'confirm', what: `press "${name || 'an unlabelled button'}" on a checkout page` };
      if (control.kind === 'submit') {
        return formHasSensitive(digest, control.form)
          ? { risk: 'high', what: `submit "${name}"` }
          : { risk: 'confirm', what: `submit "${name}"` };
      }
      return { risk: 'none', what: `press "${name}"` };
    }
    if (link) {
      // Links can trigger state changes too ("Delete", "Unsubscribe", one-click buy).
      if (HIGH_RISK.test(name)) return { risk: 'high', what: `follow "${name}"` };
      if (/\b(delete|remove|unsubscribe|log ?out|sign ?out|cancel)\b/i.test(name)) return { risk: 'confirm', what: `follow "${name}"` };
      return { risk: 'none', what: `follow "${name}"` };
    }
    return { risk: 'none', what: 'click' };
  }

  if (action.type === 'type' && control?.sensitive) {
    return { risk: 'confirm', what: `enter your ${control.sensitive === 'otp' ? 'code' : control.sensitive.replace('-', ' ')} into "${quoteUntrusted(control.name)}"` };
  }
  if (action.type === 'check' && control && action.checked && /\b(agree|accept|consent|terms|authori[sz]e|auto.?renew)\b/i.test(control.name)) {
    return { risk: 'confirm', what: `check "${quoteUntrusted(control.name)}"` };
  }
  return { risk: 'none', what: action.type };
}

/** Find an amount the page displays as a total, quoted as page-supplied (AR-3). */
export function findDisplayedTotal(digest: PageDigest): string | null {
  const texts = [...digest.main.map((b) => b.text), ...digest.controls.map((c) => c.name)];
  for (const t of texts) {
    const m = /(order total|total|amount due|you pay|grand total|to pay)[^$€£¥₹\d]{0,25}([$€£¥₹]\s?[\d.,]+|[\d.,]+\s?(usd|eur|gbp))/i.exec(t);
    if (m) return m[2]!.trim();
  }
  return null;
}

const CHALLENGE_WORDS = [
  'river', 'apple', 'candle', 'garden', 'pencil', 'orange', 'window', 'rocket', 'violin', 'forest',
  'silver', 'planet', 'tiger', 'lemon', 'harbor', 'meadow', 'copper', 'falcon', 'maple', 'pebble',
];

export interface Confirmation {
  prompt: string;
  risk: Exclude<Risk, 'none'>;
  /** For high-risk actions the user must say/type this word (AR-3). */
  challenge?: string;
}

export interface ConfirmationOptions {
  /** The committed URL from the browser, never from the page/model. */
  committedUrl: string;
  random?: () => number;
}

export function buildConfirmation(assessment: RiskAssessment, digest: PageDigest, opts: ConfirmationOptions): Confirmation {
  const risk = assessment.risk === 'none' ? 'confirm' : assessment.risk;
  const site = speakableSite(siteOf(opts.committedUrl) || 'this site');
  let prompt = `Confirm: ${assessment.what} on ${site}.${assessment.note ? ' ' + assessment.note : ''}`;
  const total = findDisplayedTotal(digest);
  if (total && risk === 'high') prompt += ` The page shows a total of ${total}; I can't verify that amount.`;
  if (risk === 'high') {
    const rnd = opts.random ?? Math.random;
    const word = CHALLENGE_WORDS[Math.floor(rnd() * CHALLENGE_WORDS.length)]!;
    return { prompt: `${prompt} This can cost money or can't be undone. To go ahead, say or type "confirm ${word}". To stop, say "cancel".`, risk, challenge: word };
  }
  return { prompt: `${prompt} Say or type "yes" to go ahead, or "no" to cancel.`, risk };
}

export type ConfirmationAnswer = 'approved' | 'declined' | 'unclear';

export function interpretAnswer(answer: string, c: Confirmation): ConfirmationAnswer {
  const a = answer.trim().toLowerCase().replace(/[.!?,"']/g, '');
  if (/^(no|nope|cancel|stop|don'?t|do not|never ?mind|abort|get me out)\b/.test(a)) return 'declined';
  if (c.challenge) {
    return a.split(/\s+/).includes(c.challenge) ? 'approved' : 'unclear';
  }
  if (/^(yes|yeah|yep|y|ok|okay|sure|confirm|go ahead|do it|proceed)\b/.test(a)) return 'approved';
  return 'unclear';
}
