# Frontier Browser — Backlog

Priority: **P0** = required for Phase 0/1 usability, **P1** = Phase 1–2,
**P2** = later. Status: ✅ done in this repo, 🟡 partial, ⬜ not started.


## E1 — Foundations
| ID | Story | Pri | Status |
|---|---|---|---|
| E1.1 | Monorepo (npm workspaces, TypeScript strict, Vitest, lint) | P0 | ⬜ |
| E1.2 | `BrowserBackend` interface so product logic never depends on Electron | P0 | ⬜ |
| E1.3 | Playwright/CDP backend for real-Chromium integration tests and a CLI | P0 | ⬜ |
| E1.4 | Chromium fork scaffolding: pinned version, `args.gn`, fetch/patch/build scripts, patch series dir | P0 | ⬜ |
| E1.5 | CI: typecheck, unit tests, integration tests on Chromium | P0 | ⬜ |
| E1.6 | Reproducible native Chromium build in CI (large runners) | P1 | ⬜ |
| E1.7 | Native fork patches: de-Google services, accessibility on by default, Frontier WebUI side panel | P1 | ⬜ |

## E2 — Page understanding (page agent)
| ID | Story | Pri | Status |
|---|---|---|---|
| E2.1 | PageDigest: title, lang, landmarks, headings, links, controls, images, tables | P0 | ⬜ |
| E2.2 | Accessible-name computation (aria-labelledby, aria-label, label[for], wrapping label, alt, title, placeholder, text) | P0 | ⬜ |
| E2.3 | Main-content extraction (landmark → article → density heuristic) with boilerplate removal | P0 | ⬜ |
| E2.4 | Page-kind classification (article, search results, form, product, listing, app) | P0 | ⬜ |
| E2.5 | Stable element refs that survive re-digest; stale-ref detection | P0 | ⬜ |
| E2.6 | Hidden / aria-hidden / inert content excluded — and its *presence* flagged | P0 | ⬜ |
| E2.7 | Shadow DOM and same-origin iframe traversal | P0 | ⬜ |
| E2.8 | Cross-origin iframes (via backend frame APIs) | P1 | ⬜ |
| E2.9 | Live-region & DOM-mutation narration (toasts, errors, chat messages) | P1 | ⬜ |
| E2.10 | Table narration with header association | P1 | ⬜ |
| E2.11 | Image description via BYO vision model, labelled "AI description" | P1 | ⬜ |
| E2.12 | PDF reading (Chromium PDF viewer accessibility tree) | P1 | ⬜ |
| E2.13 | Very large pages: digest budget, pagination of lists | P0 | ⬜ |

## E3 — Commands & conversation
| ID | Story | Pri | Status |
|---|---|---|---|
| E3.1 | Offline grammar: navigation, reading, skimming, links, forms, search, tabs, speech control, help | P0 | ⬜ |
| E3.2 | Ordinal/number/name references ("third link", "link 3", "the login button") | P0 | ⬜ |
| E3.3 | "What can I do here?" contextual discovery | P0 | ⬜ |
| E3.4 | Continuous reading with position memory ("continue", "repeat", "previous paragraph") | P0 | ⬜ |
| E3.5 | LLM planner with tool-calling and JSON fallback for small models | P0 | ⬜ |
| E3.6 | Bounded agent loop (max steps, per-step narration, cancel) | P0 | ⬜ |
| E3.7 | Clarifying questions when ambiguous (multiple matches) | P0 | ⬜ |
| E3.8 | Multi-language grammar packs (es, fr, de, pt, hi, zh, ar first) | P1 | ⬜ |
| E3.9 | User-defined shortcuts / macros by voice | P2 | ⬜ |

## E4 — Speech I/O
| ID | Story | Pri | Status |
|---|---|---|---|
| E4.1 | TTS queue with priorities and immediate barge-in | P0 | ⬜ |
| E4.2 | OS TTS (Web Speech API) — free, offline | P0 | ⬜ |
| E4.3 | BYO TTS (OpenAI-compatible `/audio/speech`) | P1 | ⬜ |
| E4.4 | Push-to-talk STT via BYO OpenAI-compatible `/audio/transcriptions` (whisper.cpp / faster-whisper local) | P0 | ⬜ |
| E4.5 | Typed command input as a first-class equal to voice (deafblind, noisy rooms, privacy) | P0 | ⬜ |
| E4.6 | Screen-reader mode: route output to ARIA live region, disable own TTS | P0 | ⬜ |
| E4.7 | Earcons for page load, error, confirmation needed, listening | P1 | ⬜ |
| E4.8 | Bundled offline STT (whisper.cpp sidecar) installer option | P1 | ⬜ |
| E4.9 | Wake word (opt-in, on-device only) | P2 | ⬜ |
| E4.10 | Speech never speaks secrets (passwords, OTP, card numbers) aloud unless asked | P0 | ⬜ |

## E5 — Safety, privacy, trust
| ID | Story | Pri | Status |
|---|---|---|---|
| E5.1 | Consequential-action detection (submit/buy/pay/send/post/delete/transfer/subscribe) | P0 | ⬜ |
| E5.2 | Spoken confirmation that restates the action and target origin | P0 | ⬜ |
| E5.3 | Sensitive-field redaction before model calls | P0 | ⬜ |
| E5.4 | Prompt-injection containment: page text delimited as untrusted data; planner can't act on page-originated instructions without confirmation | P0 | ⬜ |
| E5.5 | Per-origin "never send to AI" list; local-only mode | P0 | ⬜ |
| E5.6 | "What did you send?" audit log readable aloud | P0 | ⬜ |
| E5.7 | Keys in OS keychain (`safeStorage`); never logged | P0 | ⬜ |
| E5.8 | Phishing / lookalike-domain warning spoken before credential entry | P1 | ⬜ |
| E5.9 | Electron hardening: contextIsolation, sandbox, no nodeIntegration, CSP, permission handler, navigation guard | P0 | ⬜ |
| E5.10 | Dark-pattern narration (pre-checked boxes, countdown timers, hidden costs) | P1 | ⬜ |

## E6 — Browser fundamentals by voice
| ID | Story | Pri | Status |
|---|---|---|---|
| E6.1 | Open URL / search with user-chosen search engine (default: privacy-respecting) | P0 | ⬜ |
| E6.2 | Back / forward / reload / stop | P0 | ⬜ |
| E6.3 | Tabs: open, list, switch, close by voice | P1 | ⬜ |
| E6.4 | Bookmarks & history by voice ("open my bank", "what did I read yesterday") | P1 | ⬜ |
| E6.5 | Downloads announced, opened | P1 | ⬜ |
| E6.6 | Reader view (visual, large text, high contrast) | P1 | ⬜ |
| E6.7 | Auto-update with signed releases | P1 | ⬜ |

## E7 — Onboarding, help, UX
| ID | Story | Pri | Status |
|---|---|---|---|
| E7.1 | First-run spoken onboarding: mode choice, rate, AI optional, practice page | P0 | ⬜ |
| E7.2 | Contextual help ("help", "what can I say") | P0 | ⬜ |
| E7.3 | Verbosity levels (terse / normal / guided) | P0 | ⬜ |
| E7.4 | Accessible shell UI: WCAG 2.2 AA, keyboard-only, high contrast, 200% zoom, reduced motion | P0 | ⬜ |
| E7.5 | AI setup wizard by voice with presets (Ollama local, LM Studio, OpenAI-compatible, Anthropic) | P0 | ⬜ |
| E7.6 | Error messages that say what to do next | P0 | ⬜ |
| E7.7 | Escalation path for un-automatable pages: CAPTCHA, broken widgets — explain, offer audio CAPTCHA, offer "describe screenshot" with consent | P1 | ⬜ |

## E8 — Compliance & governance
| ID | Story | Pri | Status |
|---|---|---|---|
| E8.1 | Compliance matrix (WCAG 2.2, EN 301 549, Section 508, EAA, ADA, GDPR, CCPA/CPRA, EU AI Act, COPPA) | P0 | ⬜ |
| E8.2 | Accessibility Conformance Report (VPAT 2.5 Rev) for the shell | P1 | ⬜ |
| E8.3 | Third-party notices (Chromium BSD, Electron MIT, deps) | P0 | ⬜ |
| E8.4 | Privacy policy & AI transparency notice (spoken at onboarding) | P0 | ⬜ |
| E8.5 | Accessibility statement + feedback channel | P0 | ⬜ |
| E8.6 | User advisory panel of blind & low-vision users | P0 | ⬜ |
| E8.7 | Medical/legal/financial disclaimer: AI output not professional advice | P0 | ⬜ |
