# Frontier Browser: Backlog

**Priority:**

- **P0**: required for Phase 0 or 1 usability
- **P1**: Phase 1–2
- **P2**: later

**Status:**

- ✅ done in this repository and covered by automated tests, unless the row says otherwise
- 🟡 partial; the gap is described in the row
- ⬜ not started

Items tagged **[AR-n]** were added or changed by the
[adversarial review](ADVERSARIAL_REVIEW.md).

## E1: Foundations
| ID | Story | Pri | Status |
|---|---|---|---|
| E1.1 | Monorepo (npm workspaces, strict TypeScript, Vitest) | P0 | 🟡 no linter or formatter yet |
| E1.2 | `BrowserBackend` interface so product logic never depends on Electron | P0 | ✅ |
| E1.3 | CDP backend shared by Electron, Playwright and a future fork; Playwright transport for tests and the CLI | P0 | ✅ |
| E1.4 | Chromium fork scaffolding: pinned version, `args.gn`, fetch/patch/build scripts, patch series **(demoted to P2, gated)** [AR-7] | P2 | ✅ scaffolding only; nothing has been built |
| E1.5 | CI: typecheck, unit tests, real-Chromium integration tests | P0 | 🟡 workflow written; first run on GitHub pending |
| E1.6 | Reproducible native Chromium build in CI (large runners) [AR-7] | P2 | ⬜ |
| E1.7 | Native fork patches (see `chromium/patches/series`) [AR-7] | P2 | ⬜ |
| E1.8 | Evaluate extension-first distribution (side panel + `chrome.debugger`) [AR-4] | P1 | ⬜ |
| E1.9 | Electron end-to-end tests in CI: the real app, sandbox on, non-root, driven by typed commands and a real F9 key press | P0 | ✅ 9 tests (`--project electron`) |
| E1.10 | CLI for terminal screen readers and braille | P0 | ✅ verified manually against real Chromium |

## E2: Page understanding
| ID | Story | Pri | Status |
|---|---|---|---|
| E2.1 | PageDigest: title, lang, landmarks, headings, links, controls, images, tables | P0 | ✅ |
| E2.2 | Accessible names in JS **reconciled against Chromium's AX tree; Chromium wins** [AR-6] | P0 | ✅ |
| E2.3 | Main-content extraction (landmark → article → density heuristic) | P0 | ✅ |
| E2.4 | Page-kind classification | P0 | ✅ |
| E2.5 | Stable refs (WeakMap, never in the DOM); stale-ref detection | P0 | ✅ |
| E2.6 | Content removed from the AX tree is excluded and counted | P0 | ✅ |
| E2.7 | Shadow DOM and same-origin iframes | P0 | 🟡 open shadow roots ✅; iframes ⬜ |
| E2.8 | Cross-origin iframes (payment widgets) **raised to P0** [AR-17] | P0 | ⬜ |
| E2.9 | Live-region and DOM-mutation narration (toasts, errors, chat) | P1 | ⬜ |
| E2.10 | Table narration with header association | P1 | 🟡 caption, size and headers ✅; cell navigation ⬜ |
| E2.11 | Image description through a BYO vision model, labelled "AI description" | P1 | ⬜ |
| E2.12 | PDF reading | P1 | ⬜ |
| E2.13 | Digest budgets for huge pages | P0 | ✅ |
| E2.14 | Agent in an **isolated world**; the page can't detect or tamper with it [AR-5] | P0 | ✅ |
| E2.15 | SPA route changes treated as page loads [AR-16] | P0 | 🟡 `navigatedWithinDocument` ✅; pushState-only apps not tested |

## E3: Commands and conversation
| ID | Story | Pri | Status |
|---|---|---|---|
| E3.1 | Offline grammar (navigation, reading, skimming, forms, search, speech, privacy, help) | P0 | ✅ |
| E3.2 | Number, ordinal and name references ("third link", "link 3", "the sign in button") | P0 | ✅ |
| E3.3 | "What can I do here?", **built deterministically from page structure** [AR-16] | P0 | ✅ |
| E3.4 | Continuous reading with position memory | P0 | ✅ |
| E3.5 | BYO-model planner with native tools, plus a JSON protocol for small models | P0 | ✅ |
| E3.6 | Bounded agent loop with per-step narration and cancel | P0 | ✅ |
| E3.7 | Clarifying questions when a target is ambiguous | P0 | ✅ |
| E3.8 | Language packs (es first, to prove the format) [AR-23] | P1 | ⬜ grammar is data-driven ✅ |
| E3.9 | User-defined shortcuts and macros by voice | P2 | ⬜ |
| E3.10 | Per-request cost estimates for paid APIs [AR-14] | P1 | ⬜ |
| E3.11 | Dictation of emails and URLs ("john dot smith at…", NATO alphabet, "spell") [AR-23] | P0 | ✅ |

## E4: Speech, braille and output
| ID | Story | Pri | Status |
|---|---|---|---|
| E4.1 | TTS queue with priority and immediate barge-in | P0 | ✅ |
| E4.2 | OS TTS (Web Speech synthesis): free and offline. Falls back to text-only, and says so, when no speech engine is installed | P0 | 🟡 runs in Electron; the no-voices fallback is tested; speaking with real voices not yet heard by a person |
| E4.3 | BYO TTS (OpenAI-compatible `/audio/speech`) | P1 | 🟡 client ✅; not wired into the shell |
| E4.4 | Push-to-talk STT through a BYO `/audio/transcriptions` endpoint (whisper.cpp locally) [AR-14] | P0 | 🟡 implemented; not yet run against a real microphone and speech server |
| E4.5 | Typed commands are first-class | P0 | ✅ |
| E4.6 | Screen-reader profile: we stay silent; the log is a polite live region [AR-8] | P0 | ✅ |
| E4.7 | Earcons for confirmations, alerts and listening; browser messages only | P1 | ✅ |
| E4.8 | Bundled offline STT (whisper.cpp sidecar) | P1 | ⬜ |
| E4.9 | Wake word (opt-in, on-device only, never enrolment) | P2 | ⬜ |
| E4.10 | Secrets are never echoed or spoken | P0 | ✅ |
| E4.11 | Messages attributed to the app: UIA Notification events, NVDA Controller, JAWS FSAPI [AR-1] | P1 | ⬜ |
| E4.12 | Per-block `lang` passed to TTS for voice switching [AR-23] | P0 | ✅ |
| E4.13 | eSpeak NG fallback; native OS dictation for low-end machines [AR-14] | P1 | ⬜ |
| E4.14 | **Braille profile**: no sound, no timeouts, pannable log, readable in chunks [AR-9] | P0 | ✅ code; BRLTTY testing ⬜ |
| E4.15 | Reviewable `role="log"` transcript with source labels [AR-8] | P0 | ✅ |

## E5: Safety, privacy, trust
| ID | Story | Pri | Status |
|---|---|---|---|
| E5.1 | Consequential-action detection, including "Continue" on checkout pages and state-changing links [AR-3] | P0 | ✅ |
| E5.2 | Confirmations built from the **committed URL**; amounts quoted as "the page shows" [AR-3] | P0 | ✅ |
| E5.3 | Redaction (cards with Luhn check, SSNs, IBANs, OTPs, passwords) before model calls | P0 | ✅ |
| E5.4 | **Capability split**: ask mode has read-only tools; act mode runs under a code-enforced policy [AR-2] | P0 | ✅ |
| E5.5 | Per-origin consent (once / always / never); local models exempt; sensitive categories flagged [AR-12] | P0 | ✅ |
| E5.6 | "What did you send?" bounded audit log | P0 | ✅ in memory; encryption at rest ⬜ |
| E5.7 | Keys in the OS keychain only, bound to their origin; refuse `basic_text`; never sent to renderers [AR-13] | P0 | 🟡 code; e2e confirms the page has no bridge to the shell; keychain storage not yet exercised |
| E5.8 | Lookalike, punycode and IP-host warnings **before** the page is read; raised to P0 [AR-11] | P0 | ✅ |
| E5.9 | Electron hardening (sandbox, permissions, cert errors, popups, unload, fullscreen, UA) [AR-4] | P0 | ✅ sandbox, clean UA, no agent/Node/bridge visible to pages, permission and popup denial verified in Electron e2e; cert errors and fullscreen not yet exercised |
| E5.10 | Dark-pattern narration | P1 | 🟡 pre-checked opt-ins and urgency timers ✅; hidden costs ⬜ |
| E5.11 | Dual-LLM quarantine: a privileged planner sees handles only [AR-2] | P1 | ⬜ |
| E5.12 | Safe Browsing replacement (Update API or a local blocklist) [AR-4] | P0 | ⬜ |
| E5.13 | Grant a site permission by voice | P1 | ⬜ deny-and-announce ✅ |
| E5.14 | Trusted output channel; page impersonation reframed [AR-1] | P0 | ✅ |
| E5.15 | Random challenge word for high-risk actions; page audio muted during confirmations [AR-3] | P0 | ✅ challenge words; 🟡 muting not yet run in Electron |
| E5.16 | "Get me out" (voice plus F9; the page can't intercept it) [AR-11] | P0 | ✅ |
| E5.17 | Pages can't reach private networks or model endpoints [AR-13] | P0 | 🟡 code; needs a public-origin test page to exercise end to end |
| E5.18 | Warn when a form sends data to another site | P0 | ✅ |
| E5.19 | Prompt-injection corpus in CI [AR-2] | P0 | ✅ first 5 attack classes; expand ⬜ |
| E5.20 | Numbers, prices, doses and dates in AI answers checked against the source [AR-16] | P0 | ✅ |
| E5.21 | JS dialogs dismissed and announced; `beforeunload` can't trap the user [AR-11] | P0 | ✅ |
| E5.22 | Scam-page heuristics; no auto-read on scam pages [AR-11] | P0 | ✅ |

## E6: Browser fundamentals
| ID | Story | Pri | Status |
|---|---|---|---|
| E6.1 | Open a URL, or search with a privacy-respecting default engine | P0 | ✅ |
| E6.2 | Back, forward, reload, home | P0 | ✅ |
| E6.3 | Tabs by voice | P1 | ⬜ |
| E6.4 | Bookmarks and history by voice | P1 | ⬜ |
| E6.5 | Downloads announced | P1 | 🟡 start and finish announced; opening files ⬜ |
| E6.6 | Reader view (large text, high contrast) | P1 | ⬜ |
| E6.7 | ~~Signed releases with delta auto-update~~ **Out of scope by policy:** the project publishes no installers (DISCLAIMER §2, enforced by `scripts/check-no-distribution.mjs`) | — | won't do |
| E6.8 | Content and ad blocking with filter lists [AR-15] | P0 | ⬜ |
| E6.9 | Consent-banner handling ("reject all", announced) [AR-15] | P1 | ⬜ |
| E6.10 | Data-saver mode [AR-15] | P1 | ⬜ |
| E6.11 | Credentials (vault or OS keychain; import), passkeys and WebAuthn [AR-17] | P1 | ⬜ |
| E6.12 | OTP assist (from the clipboard or a notification, with consent) [AR-17] | P1 | ⬜ |
| E6.13 | Media controls [AR-17] | P1 | ⬜ |
| E6.14 | Native dialogs: file picker, print [AR-17] | P1 | ⬜ |

## E7: Onboarding, help, UX
| ID | Story | Pri | Status |
|---|---|---|---|
| E7.1 | Speaks on first launch with no configuration; spoken tutorial [AR-10] | P0 | 🟡 welcome message ✅; tutorial ⬜ |
| E7.2 | Contextual help | P0 | ✅ |
| E7.3 | Verbosity levels (terse, normal, guided) | P0 | ✅ |
| E7.4 | Shell UI meets WCAG 2.2 AA | P0 | 🟡 automated axe audit ✅ (light and dark); manual audit with five screen readers ⬜ |
| E7.5 | AI setup wizard: presets, each provider's data and training policy, minimum age [AR-12, AR-18] | P0 | 🟡 presets in Settings ✅; policy and age info ⬜ |
| E7.6 | Error messages say what to do next | P0 | ✅ |
| E7.7 | Escalation for CAPTCHAs and broken widgets [AR-10] | P1 | 🟡 detection ✅ |
| E7.8 | A trusted helper can set it up with a config file (`--import-config`) [AR-10] | P0 | ✅ parser tested; import path not yet run in Electron |
| E7.9 | Key remapping [AR-8] | P1 | ⬜ |
| E7.10 | Comparative study: content-first vs structure-first defaults [AR-16] | P1 | ⬜ |
| E7.11 | Budget for code signing and notarisation [AR-10] | P0 | ⬜ (not code work) |
| E7.12 | Hotkey and screen-reader conflict matrix [AR-8] | P0 | ✅ docs/HOTKEYS.md |

## E8: Compliance and governance
| ID | Story | Pri | Status |
|---|---|---|---|
| E8.1 | Compliance matrix by feature [AR-18] | P0 | ✅ docs/COMPLIANCE.md |
| E8.2 | Accessibility Conformance Report (VPAT 2.5) | P1 | ⬜ |
| E8.3 | Third-party notices; full MPL-2.0 text in LICENSE | P0 | ✅ |
| E8.19 | No silent Google traffic from the desktop app (spellcheck dictionary downloads were found and disabled; full network logs show no outside requests) | P0 | ✅ verified with Chromium net logs |
| E8.20 | Terminal version: reduce stock Chromium's own background calls to Google (flags plus blocked infrastructure hosts); document using a de-Googled Chromium | P1 | 🟡 flags applied; effect couldn't be verified in the dev sandbox |
| E8.18 | No-distribution policy enforced in CI; packages private; read-only workflow token; packaged copies announce themselves as unofficial | P0 | ✅ |
| E8.17 | Disclaimer and release of liability (DISCLAIMER.md), spoken at launch and on request ("disclaimer") | P0 | ✅ not reviewed by a lawyer |
| E8.4 | Privacy and AI transparency notice, spoken on request ("privacy") | P0 | ✅ |
| E8.5 | Accessibility statement and feedback channel | P0 | ✅ |
| E8.6 | Paid advisory panel of blind users with a veto over UX defaults [AR-21] | P0 | ⬜ (not code work) |
| E8.7 | AI output is not professional advice | P0 | ✅ system prompt and privacy notice |
| E8.8 | Codec decision [AR-19] | P1 | ⬜ |
| E8.9 | DRM / Widevine strategy and an honest statement [AR-19] | P1 | ⬜ |
| E8.10 | Licence review gate for bundled models [AR-19] | P1 | ✅ policy defined |
| E8.11 | Export-control (EAR) check [AR-19] | P1 | ⬜ |
| E8.12 | Legal memo on agent use and site terms [AR-20] | P1 | ⬜ |
| E8.13 | DPIA [AR-18] | P0 | ⬜ |
| E8.14 | Counsel review of COMPLIANCE.md | P0 | ⬜ |
| E8.15 | Threat model [AR-4] | P0 | ✅ docs/THREAT_MODEL.md |
| E8.16 | Security owner, SLA, end-of-life plan [AR-21] | P0 | 🟡 SECURITY.md and plan ✅; named owner ⬜ |
