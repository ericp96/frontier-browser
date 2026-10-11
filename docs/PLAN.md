# Frontier Browser — Product & Technical Plan

> A free, open-source, voice-first web browser for blind and low-vision people,
> built on Chromium, that the user can back with **their own** AI model — or no
> AI model at all.

Status: v0.1 plan (revised after adversarial review — see
[ADVERSARIAL_REVIEW.md](ADVERSARIAL_REVIEW.md)). Backlog: [BACKLOG.md](BACKLOG.md).
Compliance: [COMPLIANCE.md](COMPLIANCE.md).

---

## 1. Why this exists

Screen readers made the web *possible* for blind users; they did not make it
*pleasant*. Navigating a modern page by tabbing through 300 links, or by
memorising dozens of screen-reader hotkeys, is slow and exhausting. Large
language models can collapse that effort ("what's this page about?", "take me
to the checkout", "read me the recipe, skip the life story") — and vendors are
now selling exactly that as a premium subscription.

Disabled people already pay a "disability tax" in time, equipment, and
software. Frontier Browser's position is simple:

1. **Free and open source, forever.** No paid tier gates an accessibility
   feature. (License: MPL-2.0 for our code; Chromium remains BSD-3.)
2. **Bring your own model.** Point it at a local model (Ollama, llama.cpp,
   LM Studio, vLLM), a free or paid cloud model, or any OpenAI-compatible
   endpoint. We never resell inference.
3. **Useful with no AI at all.** Every core task — reading, navigating by
   heading/landmark/link, filling forms, searching, tabs — works with a
   deterministic offline command grammar. AI makes it *nicer*, never
   *possible*.
4. **Content first.** The default answer to "open a page" is the content,
   spoken, starting with what matters — not a tour of the navigation chrome.
5. **The user is in control.** Nothing consequential (purchases, posting,
   sending, deleting, submitting) happens without explicit spoken or keyed
   confirmation. Web pages can never instruct the assistant.

## 2. Who it is for (personas)

| Persona | Needs | Implication |
|---|---|---|
| **Maya**, 34, blind since birth, expert NVDA user | Speed; does not want her screen reader fought or duplicated | "Screen-reader mode": we output to ARIA live regions and let NVDA/JAWS/VoiceOver/Orca speak; our own TTS is off |
| **Walter**, 71, lost sight to macular degeneration at 68 | Never learned a screen reader; wants to just *ask* | "Voice mode": our TTS, push-to-talk or wake key, plain-language confirmations, forgiving grammar |
| **Priya**, 27, low vision | Uses magnification; voice for long reading | Large, high-contrast UI; readable "reader view"; voice optional |
| **Sam**, 45, deafblind, braille display | Text in/out only, no audio | Every spoken output also emitted as text to the live region → braille; typed commands are first-class |
| **Leo**, 19, motor + vision impairment | Limited keyboard use | Full voice control, large hit-targets, no time limits |
| **Ana**, 52, privacy-conscious, low bandwidth | Can't send pages to a cloud model; slow machine | Local-only mode, small-model friendly prompts, offline grammar, no telemetry |

## 3. Experience principles

1. **Deliver content, then offer choices.** On page load: title → one-line
   page kind ("article", "search results", "product page", "form") → the
   main content or a short summary (user preference). Then *one* short hint
   ("Say 'headings' to skim, or ask me anything").
2. **Interruptible always.** Any key or "stop" halts speech immediately
   (barge-in). Speech never blocks input.
3. **Two speeds.** Expert: terse, earcons, fast rate. Novice: full sentences,
   confirmations, examples. Verbosity is a setting *and* a command.
4. **Discovery without overload.** "What can I do here?" lists the 3–5 most
   likely actions for *this* page (search box, main article, cart, next page),
   not a generic help screen.
5. **Never lie about the page.** AI summaries are labelled as summaries.
   Anything the model *infers* (e.g. image descriptions) is labelled as
   inferred. "Read exactly" always reads the real text.
6. **Predictable, reversible, confirmable.** Back always works. Consequential
   actions require confirmation that *restates* what will happen
   ("Submit order for $42.10 to Amazon? Say yes or no").
7. **Degrade gracefully.** Model down → grammar still works. TTS engine
   missing → text to live region. Network down → local pages, history,
   saved pages.

## 4. Architecture

```
┌──────────────────────────── Frontier Browser ─────────────────────────────┐
│                                                                            │
│  Input                      Brain (packages/core)              Output      │
│  ─────                      ─────────────────────              ──────      │
│  Push-to-talk ─► STT ─┐    ┌───────────────────────────┐   ┌─► TTS        │
│  Typed command ───────┼──► │ 1. Local grammar (offline) │   │   (OS / BYO) │
│  Global hotkeys ──────┘    │ 2. LLM planner (BYO model) │ ──┼─► ARIA live  │
│                            │    tool-calling, guarded   │   │   region →   │
│                            │ 3. Safety gate: confirm,   │   │   screen     │
│                            │    redact, injection guard │   │   reader /   │
│                            └─────────────┬─────────────┘   │   braille    │
│                                          │ actions          └─► Earcons    │
│                            ┌─────────────▼─────────────┐                   │
│                            │  BrowserBackend interface  │                   │
│                            └─────────────┬─────────────┘                   │
│            ┌─────────────────────────────┼──────────────────────┐          │
│   Electron shell (apps/desktop)   Playwright/CDP (tests, CLI)   Native     │
│   = Chromium runtime, ships now   = real Chromium, headless     Chromium   │
│                                                                  fork      │
│                                                                (chromium/) │
│   In every backend: injected page agent (packages/core/page-agent)        │
│   walks DOM + ARIA → PageDigest (landmarks, headings, links, forms,       │
│   main content, images) with stable element refs for actions.            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Why a layered Chromium strategy

Forking Chromium is the long-term goal (deep accessibility-tree access,
removal of Google services, built-in privacy defaults, our own omnibox and
UI in native views, sandboxed model-host process). But a Chromium checkout is
~100 GB, a build takes hours on large machines, and rebasing on Chromium's
4-week release cadence is a full-time job. Projects that do this well
(Brave, ungoogled-chromium, Vivaldi) keep a **patch series against a pinned
Chromium version**, not a copy of the source tree. We do the same:

- `chromium/` — pinned `CHROMIUM_VERSION`, `args.gn`, fetch/patch/build
  scripts, `patches/` series. The repository never vendors Chromium source.
- `apps/desktop` — an Electron shell. Electron *is* Chromium (content layer +
  V8 + Blink + the same accessibility tree), so the product ships today on
  Windows, macOS and Linux, and every line of product logic is written
  against `BrowserBackend`, not Electron.
- When the native fork reaches parity, the same `packages/core` runs inside
  it (as a WebUI + browser-process service), and Electron becomes a fallback.

This sequencing gets a usable, free tool to users in months instead of years
— which is the actual point.

### 4.2 Core modules (`packages/core`)

| Module | Responsibility |
|---|---|
| `page-agent/` | Self-contained script injected into pages. Builds a `PageDigest`: title, language, page kind, landmarks, heading outline, links, form controls (with accessible names, required/invalid state, *sensitive* flag), images (alt or "unlabelled"), tables, main content via a readability heuristic. Assigns stable `ref`s. Executes element actions (focus, click, type, select, scroll-into-view). Computes accessible names per accname-1.2 essentials. |
| `commands/` | Deterministic grammar: ~40 intents with synonyms ("go to", "open", "visit"; "back"; "read headings"; "next link"; "click 3"; "fill email with …"; "search for …"; "stop"; "louder/faster"). Works offline. Returns structured `Intent`. |
| `ai/` | Provider adapters (OpenAI-compatible — covers Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI, Groq…; Anthropic; "none"). Tool-calling planner with a bounded step loop. Small-model-safe prompts; works without native tool-calling via JSON-mode fallback. |
| `safety/` | Consequential-action classifier, confirmation gate, sensitive-field redaction (passwords, card numbers, SSN, OTP) before anything leaves the device, prompt-injection containment (page text is quoted data, never instructions; tool calls whose arguments originated from page text that weren't requested by the user require confirmation), per-origin AI opt-out. |
| `speech/` | `SpeechOutput` (OS TTS via Web Speech API, BYO OpenAI-compatible `/audio/speech`, or text-only) with queue, priority, barge-in, rate/voice. `SpeechInput` (BYO OpenAI-compatible `/audio/transcriptions` → whisper.cpp/faster-whisper locally; platform dictation). Earcons. |
| `assistant/` | Orchestrator: input → grammar → (if no match & AI enabled) planner → safety gate → backend actions → narration. Holds conversation + page context, verbosity, mode. |
| `settings/` | Typed, versioned settings; secrets stored via OS keychain (Electron `safeStorage`), never in plain JSON. |

### 4.3 Data flow & privacy

- Default: **no AI configured, no network calls other than the pages the
  user visits.** No telemetry. No crash upload without opt-in.
- When AI is enabled, what is sent is shown in a "What did you send?" log the
  user can have read aloud. Sensitive fields are redacted on-device before
  any model call. Users can mark origins (bank, health portal) as "never
  send to AI".
- API keys live in the OS keychain.

## 5. Phased roadmap

| Phase | Goal | Exit criteria |
|---|---|---|
| **0 — Foundations** (this PR) | Plan, backlog, review, compliance map; monorepo; core engine (page agent, grammar, safety, providers, assistant); Electron shell; CLI on real Chromium; tests | Unit + real-Chromium integration tests green; a user can open a page, hear its content, navigate by heading/link, fill & submit a form with confirmation, ask a BYO model a question about the page |
| **1 — Usable daily driver** | Tabs, history, bookmarks, downloads spoken; reader view; STT via local whisper; onboarding tutorial by voice; screen-reader mode QA with NVDA/JAWS/VoiceOver/Orca; installers + auto-update | 10 blind testers complete 8 core tasks unassisted; WCAG 2.2 AA audit of our own UI passes |
| **2 — Intelligence** | Image description via BYO vision model; table/chart narration; multi-step tasks ("order my usual") with step-by-step confirmation; CAPTCHA/hard-page escalation paths; page-change narration | Task success ≥ 85% on benchmark of 50 real sites |
| **3 — Native fork** | `chromium/` builds reproducibly in CI; core runs as WebUI + browser-process service; Google services removed; native accessibility-tree access | Signed builds on 3 OSes; parity with Electron shell |
| **4 — Ecosystem** | Mobile (Android via Chromium; iOS via WebKit backend), extension API for community skills, localisation (top 20 languages), braille-first mode | — |

## 6. Success metrics (privacy-preserving; opt-in, local)

- Time-to-first-content after load (target < 1.5 s for spoken title + kind).
- Core-task completion without sighted help (testing sessions).
- Number of confirmations declined (signals false positives / unsafe plans).
- Zero accessibility features behind payment. Zero default telemetry.

## 7. Governance

- Accessibility decisions are made **with** blind users: a paid (by grants,
  not users) user advisory panel reviews each phase.
- Funding: grants, donations, sponsorships — never per-user fees for
  accessibility features.
- Security disclosures: `SECURITY.md`. Code of conduct: Contributor Covenant.
