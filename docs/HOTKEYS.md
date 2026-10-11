# Keyboard Map and Screen-Reader Conflict Matrix

Frontier keys are processed by the browser process **before** the page sees
them. A page can't intercept or override them (AR-8, AR-11). They are plain
function keys, chosen because the major screen readers use modifier keys
(Insert, CapsLock, Ctrl+Option) for their own commands and leave single
function keys free.

| Key | Action | NVDA | JAWS | Narrator | VoiceOver (macOS) | Orca |
|---|---|---|---|---|---|---|
| **F2** (hold) | Push-to-talk | free (NVDA uses NVDA+F2 for pass-through) | free (JAWS uses Insert+F2) | free | free | free |
| **F3** | Focus the command box | free | free (browser find-next, which we replace) | free | free | free |
| **F4** | Stop speaking | free | free | free | free | free |
| **F6** | Switch between the Frontier panel and the page (Shift+F6 goes to the page) | matches the browser convention | matches the browser convention | matches the browser convention | matches the browser convention | matches the browser convention |
| **F9** | **Get me out**: closes the page and goes home | free | free | free | free | free |
| **Esc** (in the command box) | Stop speaking | free | free | free | free | free |
| **↑ / ↓** (in the command box) | Command history | n/a (focus mode) | n/a (forms mode) | n/a | n/a | n/a |

Rules:

- Frontier **never** binds single letters (H, K, B, F…). Those are
  browse-mode keys in every screen reader.
- Frontier **never** binds Insert, CapsLock, or Ctrl+Option combinations.
- On laptops where F-keys need Fn, every action also has a spoken or typed
  command ("stop", "get me out", "help").
- Remapping is in the backlog (E7.9). Until then, the voice and typed
  commands are the fallback.
- **Mac caveat:** macOS maps F3 and F4 to Mission Control and Launchpad by
  default. Users either enable "Use F1, F2, etc. keys as standard function
  keys" or press Fn. The onboarding tutorial will say this.
