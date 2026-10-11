/**
 * Check facts in a model's answer against the page it was given (AR-16).
 *
 * Wrong doses, prices and dates are the most harmful hallucinations for
 * someone who can't glance at the page. Any number, amount, percentage or
 * date in the answer that doesn't appear in the source is announced as
 * unverified.
 */

const NUMERIC = /(?<![\w.])(?:[$€£¥₹]\s?)?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|mg|ml|g|kg|km|mi|lbs?|usd|eur|gbp|am|pm)(?![a-z]))?/gi;

function canon(s: string): string {
  return s.toLowerCase().replace(/[,\s]/g, '').replace(/\.0+$/, '');
}

export interface Verification {
  unverified: string[];
}

export function verifyAgainstSource(answer: string, rawSource: string): Verification {
  // Element refs like [e15] are ours, not the page's.
  const source = rawSource.replace(/\[e\d+\]/g, ' ');
  const src = canon(source);
  const srcNums = new Set((source.match(NUMERIC) ?? []).map((m) => canon(m).replace(/[^\d.]/g, '')));
  const unverified: string[] = [];
  for (const m of answer.match(NUMERIC) ?? []) {
    const raw = m.trim();
    const digits = raw.replace(/[^\d.]/g, '');
    // Single small digits ("1 of 3", "step 2") are rarely the harmful kind.
    if (digits.replace('.', '').length < 2 && !/[$€£¥₹%]/.test(raw)) continue;
    if (src.includes(canon(raw)) || srcNums.has(digits)) continue;
    if (!unverified.includes(raw)) unverified.push(raw);
  }
  return { unverified };
}
