import type { PageDigest } from '../types.js';
import type { ElementKind, Target } from './grammar.js';

export interface Candidate {
  ref: string;
  label: string;
  kind: Exclude<ElementKind, 'any'>;
}

function clean(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function candidates(digest: PageDigest, kind: ElementKind): Candidate[] {
  const out: Candidate[] = [];
  const want = (k: ElementKind) => kind === 'any' || kind === k;
  if (want('link')) for (const l of digest.links) out.push({ ref: l.ref, label: l.text, kind: 'link' });
  if (want('button')) for (const c of digest.controls) if (c.kind === 'button' || c.kind === 'submit') out.push({ ref: c.ref, label: c.name, kind: 'button' });
  if (want('field')) for (const c of digest.controls) if (c.kind !== 'button' && c.kind !== 'submit') out.push({ ref: c.ref, label: c.name, kind: 'field' });
  if (want('heading')) for (const h of digest.headings) out.push({ ref: h.ref, label: h.text, kind: 'heading' });
  if (want('landmark')) for (const l of digest.landmarks) out.push({ ref: l.ref, label: l.name || l.role, kind: 'landmark' });
  if (want('image')) for (const i of digest.images) if (!i.decorative) out.push({ ref: i.ref, label: i.alt ?? 'unlabelled image', kind: 'image' });
  return out;
}

export type Resolution =
  | { status: 'found'; candidate: Candidate }
  | { status: 'ambiguous'; options: Candidate[] }
  | { status: 'none' };

/**
 * Resolve a spoken target against the page.
 * @param lastList the list the user most recently heard, so "number 3" means
 *   the third thing they were just told about.
 */
export function resolveTarget(target: Target, digest: PageDigest, lastList?: Candidate[]): Resolution {
  let pool: Candidate[];
  if (target.ordinal !== undefined) {
    pool = target.kind === 'any' && lastList?.length ? lastList : candidates(digest, target.kind === 'any' ? 'link' : target.kind);
    if (lastList?.length && target.kind !== 'any' && lastList.every((c) => c.kind === target.kind)) pool = lastList;
    const idx = target.ordinal < 0 ? pool.length + target.ordinal : target.ordinal - 1;
    const c = pool[idx];
    return c ? { status: 'found', candidate: c } : { status: 'none' };
  }
  const name = clean(target.name ?? '');
  if (!name) return { status: 'none' };
  pool = candidates(digest, target.kind);
  const words = name.split(' ');
  const scored = pool
    .map((c) => {
      const label = clean(c.label);
      let score = 0;
      if (label === name) score = 100;
      else if (label.startsWith(name)) score = 80;
      else if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label)) score = 70;
      else if (label.includes(name)) score = 50;
      else {
        const hits = words.filter((w) => w.length > 1 && label.split(' ').includes(w)).length;
        if (hits) score = 30 * (hits / words.length);
      }
      // Prefer interactive elements for ambiguous kinds.
      if (score && target.kind === 'any' && (c.kind === 'button' || c.kind === 'field')) score += 1;
      return { c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: 'none' };
  const best = scored[0]!.score;
  const top = scored.filter((s) => s.score === best);
  // Identical labels pointing at the same href are effectively one target.
  const unique = top.filter((s, i) => top.findIndex((t) => clean(t.c.label) === clean(s.c.label) && t.c.kind === s.c.kind) === i);
  if (unique.length === 1 || best >= 100) return { status: 'found', candidate: top[0]!.c };
  return { status: 'ambiguous', options: unique.slice(0, 5).map((s) => s.c) };
}
