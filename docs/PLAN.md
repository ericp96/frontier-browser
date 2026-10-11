# Frontier Browser: Product and Technical Plan

> A free, open-source, voice-first web browser for blind, low-vision and
> deafblind people, built on Chromium, that the user can back with **their
> own** AI model or with no AI model at all.

**Status:** v0.2. Revised after the [adversarial review](ADVERSARIAL_REVIEW.md)
(24 findings, all dispositioned).

**Related documents:**

- [BACKLOG.md](BACKLOG.md): the work, with status
- [COMPLIANCE.md](COMPLIANCE.md): obligations by feature
- [THREAT_MODEL.md](THREAT_MODEL.md): security threats and controls
- [HOTKEYS.md](HOTKEYS.md): keyboard map and screen-reader conflicts
- [PRIVACY.md](PRIVACY.md): privacy and AI notice
- [ACCESSIBILITY.md](ACCESSIBILITY.md): accessibility statement
- [chromium/README.md](../chromium/README.md): the gated native fork

**Phase 0b implementation in this repository:**

- core engine
- Electron shell
- CLI
- 130+ automated tests, including real-Chromium integration tests and an
  automated WCAG audit

What is *not* done yet is marked in the backlog. Nothing here has been tested
by blind users yet, and that is the next gate.

---

## 1. Why this exists

Screen readers made the web *possible* for blind users. They did not make it
*pleasant*. Navigating a modern page by tabbing through 300 links, or by
memorising dozens of screen-reader hotkeys, is slow and exhausting. Large
language models can collapse that effort. Examples: "what's this page
about?", "take me to the checkout", "read me the recipe, skip the life
story". Vendors are now selling exactly that as a premium subscription.

Disabled people already pay a "disability tax" in time, equipment and
software. Frontier's position is simple:

1. **Free and open source, forever.** No paid tier gates an accessibility
   feature. Licence: MPL-2.0 for our code. Chromium remains BSD-3.
2. **Bring your own model.** Point it at any of these:
   - a local model (Ollama, llama.cpp, LM Studio, vLLM)
   - a free or paid cloud model
   - any OpenAI-compatible endpoint
   - Anthropic's Claude

   We never resell inference.
3. **Useful with no AI at all.** Every core task works with a deterministic
   offline command grammar: reading, skimming by heading, landmark or link,
   filling forms, searching, and safety. AI makes things *nicer*, never
   *possible*.
4. **Content first.** The default answer to "open a page" is the content,
   starting with what matters, not a tour of the navigation chrome.
5. **The user is in control.** Nothing consequential happens without
   explicit confirmation built from facts the browser verified: purchases,
   posting, sending, deleting, submitting. Web pages can never instruct the
   assistant.

### 1.1 Why an expert screen-reader user would use it (AR-8)

Frontier is designed as a **companion to your screen reader, not a
replacement**. In screen-reader mode Frontier stays silent: its messages
go to a reviewable log, and your screen reader reads them. It adds three
things a screen reader can't do:

- answers about a page in your own words, from a model you choose
- multi-step tasks that pass through confirmations
- scam and lookalike warnings before the page speaks

The landscape we must beat on cost and privacy, while matching on quality:

| Product | What it offers |
|---|---|
| JAWS FS Companion and Picture Smart | Paid. Freedom Scientific's AI features inside JAWS |
| NVDA AI add-ons | Free, but bring-your-own-key setup is hard |
| Be My AI | Free. Image description |
| Gemini in Chrome, Copilot Vision | Cloud-only and account-bound |
| AI browsers (Comet and others) | Agentic, but not designed for blind users and not private |

## 2. Who it is for (personas)

| Persona | Needs | Implication |
|---|---|---|
| **Maya**, 34, blind since birth, expert NVDA user | Speed. Does not want her screen reader fought or duplicated | Screen-reader profile: we stay silent and the log is a polite live region. Function-key-only hotkeys that avoid screen-reader keys |
| **Walter**, 71, lost his sight to macular degeneration at 68 | Never learned a screen reader. Wants to just *ask*. Some hearing loss | Voice profile with OS TTS working from first launch and no configuration. A trusted helper can set it up through a config file. Guided mode. Plain-language confirmations |
| **Priya**, 27, low vision | Uses magnification. Voice for long reading | Large, high-contrast UI that works at 200% zoom. Voice optional |
| **Sam**, 45, deafblind, braille display | Text in and out only, no audio | Braille profile from day one: no sound, no timeouts, everything in a pannable log, typed commands first-class |
| **Leo**, 19, motor and vision impairment | Limited keyboard use | Full voice control, large hit targets, no time limits |
| **Ana**, 52, privacy-conscious, low bandwidth, old laptop | Can't send pages to a cloud model. Slow machine | Local-only mode, small-model JSON protocol, offline grammar, no telemetry |

**Scope, stated honestly (AR-23).** Desktop (Windows, macOS, Linux) comes
first. Most of the world's blind users browse on phones. Android, via a
Chromium WebView backend, is designed for from day one through the
`BrowserBackend` interface, but it ships in Phase 4. iOS forces WebKit, so an
iOS version would be a WebKit backend, not Chromium. Commands are English
first. The grammar is data, so other language packs plug in.

## 3. Experience principles

1. **Safety, then orientation, then content.** On page load we announce, in
   order:
   1. any lookalike, scam or insecure-connection warning
   2. the title and the page kind ("Article, about 4 minutes to read",
      "Form with 5 fields", "Search results")
   3. the content itself

   For apps, forms and search results, "the content" means orientation (top
   3 results, the list of fields) rather than reading everything. Scam
   pages are never auto-read.
2. **Interruptible always.** Any key, any command, or "stop" halts speech
   immediately. Push-to-talk stops our own speech before recording.
3. **Two speeds.** Expert mode is terse. Guided mode is full sentences with
   examples. Verbosity is both a setting and a command.
4. **Discovery without overload, and without manipulation.** "What can I do
   here?" lists up to 5 actions built **deterministically** from page
   structure. A page can't put "Claim your prize" at the top (AR-16).
5. **Never lie about the page.** AI output is labelled "AI". Summaries are
   labelled as summaries. When an AI answer contains a number, price, dose
   or date Frontier can't find on the page, Frontier says so.
6. **Predictable, reversible, confirmable.** Confirmations restate the
   action and the **browser-verified** site. High-risk actions need a
   random challenge word, not "yes". Confirmations never time out (AR-3, AR-9).
7. **Degrade gracefully.**
   - If the model is down, the grammar still works.
   - If the speech engine is missing, text goes to the log and the screen
     reader.
   - If speech recognition isn't set up, typing works.

## 4. Architecture

```
┌──────────────────────────── Frontier Browser ─────────────────────────────┐
│  TRUSTED SHELL (separate WebContents; pages can't reach it — AR-1)        │
│  command box · push-to-talk · reviewable role=log transcript · earcons    │
│  profiles: voice (TTS) │ screen-reader (log=live region) │ braille        │
│        ▲ announcements (tagged browser / page / ai)        │ commands      │
│        │                                                    ▼              │
│  MAIN PROCESS: packages/core Assistant                                     │
│   1. offline grammar ──► 2. BYO-model planner (ask: read-only tools;      │
│                              act: action tools)                            │
│   3. policy (code, not model): no unnamed sites, no un-said text, no      │
│      secrets typed by models ──► 4. safety gate + challenge words         │
│   privacy: per-origin consent · minimal chunks · redaction · audit log    │
│   keys: OS keychain, never in renderers (AR-13)                           │
│        │ CdpBackend (same code for Electron, Playwright, native fork)     │
│        ▼                                                                   │
│  UNTRUSTED PAGE (sandboxed, no preload, hardened session)                 │
│   page agent in an ISOLATED WORLD (AR-5) → PageDigest, reconciled with    │
│   Chromium's accessibility tree (AR-6); trusted input events (AR-20)      │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Chromium strategy, reordered by the review (AR-4, AR-7)

- **Ship on Electron now.** Electron is Chromium's content layer, Blink, V8
  and accessibility tree. Every line of product logic targets
  `BrowserBackend`. Electron's weaknesses are covered by
  `apps/desktop/src/hardening.ts` and the threat model:
  - a slower patch cadence
  - no Safe Browsing
  - the Electron user agent
  - permission and certificate prompts

  **Patch SLA:** each Electron security release ships within 7 days, or
  the app announces on launch that it is out of date.
- **Evaluate extension-first distribution (E1.8).** A Chrome or Chromium
  side panel plus content scripts with an optional native helper would
  bring Google's patch cadence, Safe Browsing, passkeys and password
  managers for free, and lets experts keep their browser. `CdpBackend`
  maps onto `chrome.debugger`.
- **The native fork is P2 and gated.** `chromium/` holds a patch series
  pinned to a Chromium version, with fetch, patch and build scripts, but
  nothing ships from it until the go/no-go criteria in
  [chromium/README.md](../chromium/README.md) are met:
  - a named capability that can't be built any other way
  - 2+ funded engineers for 3 years
  - a proven 72-hour security SLA
  - signing and update infrastructure
  - advisory panel sign-off

  Until then: **contribute upstream**.

### 4.2 Core modules (`packages/core`)

| Module | Responsibility |
|---|---|
| `page-agent/` | A self-contained script injected into an isolated world. Builds the `PageDigest`: landmarks, headings, links, form controls (with sensitive, required, invalid and pre-checked flags), images, tables, main content and page kind, plus warnings (scam, CAPTCHA, modal, pre-checked opt-in, urgency timers, insecure password). Uses stable WeakMap refs, so it never writes to the DOM. |
| `backend/` | `BrowserBackend` interface. `CdpBackend` provides the isolated world, accessibility-tree reconciliation, trusted input, navigation and history, and dialog and unload handling. |
| `commands/` | Data-driven offline grammar (around 50 intents), resolving targets by number, ordinal and name, with clarification when a target is ambiguous. |
| `ai/` | Providers: OpenAI-compatible and Anthropic (with server-side refusal fallback). A bounded planner with ask/act tool sets and a JSON protocol for models without tool calling. Number and date verification. |
| `safety/` | Gate (risk, confirmations, challenge words, cross-site form warning). Policy for model-planned actions. URL facts (registrable domain, lookalikes, punycode, IP hosts, private hosts). |
| `privacy/` | Per-origin consent, sensitive-site categories, redaction, minimal context selection, bounded audit log. |
| `speech/` | Announcement channel with source tagging. TTS queue with priority and barge-in. BYO STT and TTS clients. |
| `assistant/` | The orchestrator: content-first narration, reading with position memory, skimming, lists, forms, discovery, panic, consent, confirmations. |

## 5. Phased roadmap

| Phase | Goal | Exit criteria |
|---|---|---|
| **0a: Foundations (docs and governance)** | Plan, backlog, adversarial review, compliance matrix, threat model, hotkey matrix; a paid advisory panel of blind users recruited | Docs ✅. Panel recruited ⬜ (not code work) |
| **0b: Engine and shell** (this repo) | Core engine, Electron shell, CLI, real-Chromium tests, automated WCAG audit | ✅ in code. **Remaining:** Electron end-to-end tests in CI; manual SR and braille QA across NVDA, JAWS, Narrator, VoiceOver and Orca |
| **1: Usable daily driver** | Tabs, bookmarks and history by voice; content blocking; Safe Browsing replacement; cross-origin iframes; credentials and passkeys; OTP assist; on-device STT option; voice onboarding tutorial; signed installers and auto-update | Cohort testing (§6) passes. Counsel signs off COMPLIANCE.md. "Log in with 2FA" task passes |
| **2: Intelligence** | Image description (BYO vision); table and chart narration; dual-LLM quarantine; page-change narration; multi-step tasks with step-by-step confirmation | Benchmark on recorded fixtures ≥ 85% task success. Injection attack success ≤ 1% on the corpus |
| **3: Native fork (gated)** | Only if the go/no-go criteria are met | 72-hour SLA proven over 3 releases |
| **4: Ecosystem** | Android backend, community language packs, community skills | — |

## 6. How we measure (AR-14, AR-22)

**User cohorts.** Every cohort round must include:

- 3 or more people aged 60+ who became blind recently
- 2 or more deafblind braille users
- 3 or more expert users covering different screen readers
- 2 or more low-vision users
- 2 or more people on low-end hardware

**Hard safety metrics**, which gate releases:

- 0 consequential actions without confirmation
- spoofed browser prompts are distinguishable 100% of the time
- injection attack success rate on the corpus ≤ 1%

**Hardware tiers and performance gates:**

| Tier | Machine | Must work |
|---|---|---|
| T1 | 4 GB RAM, no GPU, 2015-era CPU | No-AI mode. Cold start < 5 s. Spoken title within 1.5 s of load |
| T2 | 8 GB RAM | Plus a small local model (1–3B) through llama.cpp or Ollama |
| T3 | 16 GB+ or cloud | Plus 7B+ local models or cloud models, and vision |

**Assistive-technology test matrix, run every release:**

- NVDA on Windows
- JAWS on Windows
- Narrator
- VoiceOver on macOS
- Orca on GNOME
- BRLTTY braille

**Benchmarks:** recorded site fixtures (HAR or WARC) for regression, plus a
live-site canary. Live sites change too often to serve as the benchmark.

**Privacy-preserving by construction:** none of these metrics come from
telemetry (COMPLIANCE P-1). They come from consented testing sessions.

## 7. Governance (AR-21)

- **Built with blind users:** a paid advisory panel of blind, low-vision
  and deafblind users, recruited before Phase 0b exits, with a **veto over
  UX defaults**. Blind contributors are actively sought as maintainers.
- **Security ownership:** a named security owner and the SLA in
  [SECURITY.md](../SECURITY.md). A minimum security-maintenance budget must
  be funded **before** public release.
- **End of life:** if the project can't keep up with security patches, the
  app announces that it is out of support, helps users move bookmarks and
  settings to Chrome or Firefox, and refuses to auto-load the web after 30
  days without a patch.
- **Funding:** grants, donations and sponsorships. Never per-user fees for
  accessibility.
- **Licensing:** MPL-2.0 keeps improvements to our files open while
  allowing integration into other products.
