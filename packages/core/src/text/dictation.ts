/**
 * Turning spoken words into the characters people meant. Speech-to-text
 * output for emails and URLs is notoriously wrong ("john dot smith at gmail
 * dot com"), and blind users can't glance at the field to fix it.
 */

const NATO: Record<string, string> = {
  alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f',
  golf: 'g', hotel: 'h', india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l',
  mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r', sierra: 's',
  tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', 'x-ray': 'x',
  yankee: 'y', zulu: 'z',
};

const DIGITS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};

const SYMBOLS: Record<string, string> = {
  dot: '.', period: '.', point: '.', at: '@', dash: '-', hyphen: '-', minus: '-',
  underscore: '_', 'under score': '_', slash: '/', 'forward slash': '/', colon: ':',
  plus: '+', hash: '#', hashtag: '#', ampersand: '&', 'question mark': '?', equals: '=',
  tilde: '~',
};

/**
 * Normalise dictated text for a field that holds an email, URL, username or
 * code. Free text (messages, search queries) should NOT go through this.
 */
export function normalizeDictation(input: string, kind: 'email' | 'url' | 'code' = 'email'): string {
  let s = ` ${input.trim().toLowerCase()} `;
  if (/^\s*spell(ed)?\s/.test(s)) s = ' ' + s.replace(/^\s*spell(ed)?\s+/, '') + ' ';
  s = s.replace(/\bdouble ([a-z0-9])\b/g, '$1$1');
  s = s.replace(/\btriple ([a-z0-9])\b/g, '$1$1$1');
  // Multi-word symbols first.
  for (const [word, sym] of Object.entries(SYMBOLS).sort((a, b) => b[0].length - a[0].length)) {
    if (word === 'at' && kind !== 'email') continue;
    s = s.replace(new RegExp(`\\s${word}\\s`, 'g'), ` ${sym} `);
  }
  if (kind === 'url') s = s.replace(/\s(www)\s/g, ' www ');
  const tokens = s.trim().split(/\s+/).map((t) => NATO[t] ?? DIGITS[t] ?? t);
  // Join everything: emails/URLs/codes never contain spaces.
  return tokens.join('');
}

/** True when the text looks like it was meant to be an email address. */
export function looksLikeSpokenEmail(s: string): boolean {
  return /\bat\b/i.test(s) && /\b(dot|period)\b/i.test(s);
}

export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (/^(https?:\/\/|about:|file:\/\/)/i.test(t)) return true;
  if (/\s/.test(t)) return false;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) || /^localhost(:\d+)?(\/\S*)?$/.test(t);
}

/** Convert what the user said ("example dot com", "news.bbc.co.uk") to a URL. */
export function toUrl(spoken: string): string | null {
  let t = spoken.trim();
  if (!looksLikeUrl(t) && /\b(dot)\b/i.test(t)) t = normalizeDictation(t, 'url');
  if (!looksLikeUrl(t)) return null;
  if (/^(https?:\/\/|about:|file:\/\/)/i.test(t)) return t;
  if (/^localhost/i.test(t)) return 'http://' + t;
  return 'https://' + t;
}
