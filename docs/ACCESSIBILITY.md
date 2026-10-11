# Accessibility Statement

Frontier exists for blind, low-vision and deafblind people, so its own
interface has to meet a higher bar than the web it browses.

> This statement describes goals and the checks run so far. It is **not a
> claim or certification of conformance**. See [DISCLAIMER.md](../DISCLAIMER.md).

**Target:** WCAG 2.2 Level AA and EN 301 549 v3.2.1 (clause 11 software, and
the clause 4.2 functional performance statements).

**What we check today**

- An automated axe-core audit (WCAG 2.0/2.1/2.2 A and AA rules) runs in CI
  against the shell and the settings dialog, in both light and dark themes.
- Every function works by keyboard, by typing, and by voice. Nothing needs a
  mouse, a sound, or speech.
- Three profiles:
  - **Voice:** Frontier speaks.
  - **Screen reader:** your screen reader speaks and Frontier stays quiet.
  - **Braille:** text only, no sound, no timeouts.
- Messages stay in a reviewable conversation log. You can read it line by
  line or pan it on a braille display, instead of losing short-lived
  announcements.
- Large default text, high contrast in light, dark and Windows
  high-contrast modes, and thick focus outlines. Reduced motion is
  respected, and the layout works at 200% zoom.
- Confirmations never time out.

**Known limitations**

- A manual audit with NVDA, JAWS, Narrator, VoiceOver and Orca is not done
  yet. It is a Phase 1 requirement.
- Keys can't be remapped yet. The voice and typed commands are the
  fallback.
- Only English commands are supported so far. The grammar is data-driven so
  other languages can be added.

**Feedback.** Open an issue on the project repository, or tell your helper
to. Accessibility bugs are treated as severity 1.
