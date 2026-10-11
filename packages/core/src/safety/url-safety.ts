/**
 * URL and origin facts computed by trusted code — never taken from the page
 * or the model. These feed confirmations and warnings (AR-3, AR-11, AR-13).
 */

// Common multi-label public suffixes. Not the full Public Suffix List, but
// enough that "shop.amazon.co.uk" is announced as "amazon.co.uk".
const MULTI_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'ltd.uk', 'plc.uk', 'nhs.uk', 'police.uk',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'co.nz', 'govt.nz', 'org.nz',
  'co.jp', 'or.jp', 'ne.jp', 'go.jp', 'ac.jp', 'co.kr', 'or.kr', 'go.kr',
  'com.br', 'gov.br', 'org.br', 'com.mx', 'gob.mx', 'com.ar', 'gob.ar', 'com.co',
  'co.in', 'gov.in', 'org.in', 'ac.in', 'nic.in', 'com.cn', 'gov.cn', 'org.cn',
  'com.tw', 'gov.tw', 'com.hk', 'gov.hk', 'com.sg', 'gov.sg', 'co.za', 'gov.za',
  'org.za', 'com.tr', 'gov.tr', 'co.il', 'gov.il', 'com.eg', 'com.sa', 'gov.sa',
  'com.pl', 'gov.pl', 'co.id', 'go.id', 'com.my', 'gov.my', 'com.ph', 'gov.ph',
  'com.vn', 'gov.vn', 'com.ng', 'gov.ng', 'co.ke', 'go.ke', 'github.io', 'gitlab.io',
  'blogspot.com', 'herokuapp.com', 'netlify.app', 'vercel.app', 'pages.dev',
  'web.app', 'firebaseapp.com', 'azurewebsites.net', 'cloudfront.net', 'appspot.com',
]);

export function isIpAddress(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || /^[0-9a-f:]+$/i.test(host) && host.includes(':');
}

/** "www.shop.amazon.co.uk" → "amazon.co.uk". */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isIpAddress(host) || !host.includes('.')) return host;
  const labels = host.split('.');
  const last2 = labels.slice(-2).join('.');
  if (labels.length >= 3 && MULTI_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function siteOf(url: string): string {
  try {
    return registrableDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

/** Private, loopback and link-local hosts. Pages must never reach these (AR-13). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return false;
}

// Brands that phishing targets most, especially against older users.
const BRANDS = [
  'paypal', 'apple', 'icloud', 'amazon', 'google', 'gmail', 'microsoft', 'outlook', 'office',
  'live', 'facebook', 'instagram', 'whatsapp', 'netflix', 'chase', 'wellsfargo',
  'bankofamerica', 'citi', 'capitalone', 'americanexpress', 'amex', 'usbank', 'hsbc',
  'barclays', 'santander', 'lloyds', 'natwest', 'venmo', 'zelle', 'cashapp', 'coinbase',
  'binance', 'irs', 'ssa', 'medicare', 'usps', 'fedex', 'ups', 'dhl', 'royalmail', 'hmrc',
  'ebay', 'walmart', 'target', 'costco', 'bestbuy', 'linkedin', 'dropbox', 'docusign',
  'adobe', 'steam', 'roblox', 'xfinity', 'comcast', 'verizon', 'att', 'tmobile',
];
const BRAND_SET = new Set(BRANDS);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

const HOMOGLYPH_DIGITS: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

export interface UrlAssessment {
  site: string;
  warnings: string[];
  /** A strong signal; the assistant warns BEFORE reading the page. */
  dangerous: boolean;
}

export function assessUrl(url: string): UrlAssessment {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { site: '', warnings: [], dangerous: false };
  }
  const warnings: string[] = [];
  let dangerous = false;
  const host = u.hostname.toLowerCase();
  const site = registrableDomain(host);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { site, warnings, dangerous };

  if (host.split('.').some((l) => l.startsWith('xn--'))) {
    warnings.push(`This web address uses special international characters that can imitate other sites. The real address is ${host}.`);
    dangerous = true;
  }
  if (isIpAddress(host) && !isPrivateHost(host)) {
    warnings.push('This site has a number for an address instead of a name. Legitimate banks and shops never do this.');
    dangerous = true;
  }
  const label = site.split('.')[0] ?? '';
  if (label && !BRAND_SET.has(label)) {
    const deglyphed = label.replace(/[0-9]/g, (d) => HOMOGLYPH_DIGITS[d] ?? d).replace(/rn/g, 'm').replace(/vv/g, 'w');
    for (const brand of BRANDS) {
      if (brand.length < 4) continue;
      const containsBrand = label.includes(brand) && label !== brand;
      const nearBrand = deglyphed === brand || (brand.length >= 6 && levenshtein(label, brand) === 1);
      if (nearBrand || (containsBrand && /secure|login|verify|account|support|update|billing|help|service|wallet|refund/.test(label))) {
        warnings.push(`Careful: this site is "${site}", which is not the real ${brand}. It may be a fake site.`);
        dangerous = true;
        break;
      }
    }
    // Brand used as a subdomain of an unrelated site: paypal.com.secure-login.xyz
    if (!dangerous) {
      const sub = host.slice(0, Math.max(0, host.length - site.length - 1));
      for (const brand of BRANDS) {
        if (brand.length >= 4 && new RegExp(`(^|\\.)${brand}(\\.|-|$)`).test(sub)) {
          warnings.push(`Careful: this address starts with "${brand}" but the site is really "${site}".`);
          dangerous = true;
          break;
        }
      }
    }
  }
  if (u.protocol === 'http:' && !isPrivateHost(host)) {
    warnings.push('This page is not secure. Do not enter passwords or card details here.');
  }
  return { site, warnings, dangerous };
}

/** Spell out a domain when it's unusual, so lookalikes are audible ("p-a-y-p-a-1"). */
export function speakableSite(site: string): string {
  const label = site.split('.')[0] ?? site;
  if (/\d/.test(label) || label.includes('-') || label.length <= 3) {
    return `${site}, spelled ${site.split('').map((c) => (c === '.' ? 'dot' : c === '-' ? 'dash' : c)).join(' ')}`;
  }
  return site;
}
