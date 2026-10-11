# Threat Model

Frontier's users are disproportionately targeted by scams. They also can't
glance at the address bar or the screen to catch a problem. The assistant can
act on their behalf, so a compromised assistant is worse than a compromised
page. This document lists the assets we protect, who attacks them, and the
control for each. It is required for Phase 0 to exit (AR-4).

## Assets

1. The user's **trust channel**: what Frontier says must be distinguishable from what a page says.
2. The user's **accounts, money and data** in their logged-in sessions.
3. The user's **secrets**: AI keys, passwords, one-time codes.
4. The user's **privacy**, including the fact that they are disabled.
5. **Local services**: Ollama, whisper.cpp, and router admin pages on the LAN.

## Adversaries

| Adversary | Capability |
|---|---|
| A1: malicious page | Arbitrary HTML, CSS and JS in the page; can open dialogs, play audio, create live regions, and imitate any text |
| A2: page that injects instructions | Writes text meant for the AI (visible, hidden, alt text, aria-label) |
| A3: compromised or misbehaving model | Returns arbitrary tool calls and text (via injection, a bad model, or a hostile endpoint) |
| A4: scammer | Tech-support scams, fake shops, lookalike domains, phone scripts |
| A5: local malware | Runs as the user (out of scope beyond OS keychain protection) |

## Threats and controls

| # | Threat | Adversary | Control | Where | Test |
|---|---|---|---|---|---|
| T1 | Page imitates a browser prompt ("Frontier asks: say yes") | A1 | Browser output comes from a separate trusted WebContents with source labels. Page text claiming to be the browser is reframed as "The page says". Confirmations use earcons that pages can't trigger. High-risk actions need a random challenge word the page can't know | shell, `speech/output.ts`, `safety/gate.ts` | `assistant.test.ts` "pretending to be the browser"; `shell.integration.test.ts` |
| T2 | Injected instructions drive the agent to act | A2, A3 | Ask mode has no action tools. Act-mode policy is enforced in code: navigation to sites the user didn't name, off-site links, and typing text the user didn't say all need confirmation. Models may never type secrets. Every consequential action goes through the gate | `safety/policy.ts`, `ai/planner.ts` | "prompt-injection corpus" suite |
| T3 | Confirmation is answered by page audio or by our own TTS feedback | A1 | Page audio is muted during confirmations. Push-to-talk stops TTS before recording. No always-on microphone. Challenge word for high risk | desktop `main.ts`, `shell.js` | manual QA |
| T4 | Confirmation shows false facts (price, merchant) | A1 | The origin comes from the committed URL (registrable domain, spelled out if unusual). Amounts are quoted as "the page shows… I can't verify". Cross-site form targets are announced | `safety/gate.ts` | `safety.test.ts` |
| T5 | Page detects or lies to the agent | A1 | Isolated world; no DOM writes; prototype patches in the page's world don't affect us; names are reconciled with Chromium's AX tree | `cdp-backend.ts` | `chromium.integration.test.ts` isolation and AX |
| T6 | Hidden text reaches the model | A2 | Content removed from the AX tree (display:none, hidden, aria-hidden, inert) is excluded from the digest | `page-agent.ts` | `page-agent.test.ts` |
| T7 | Scam page narrated in the trusted voice | A4 | Lookalike, IP and punycode warnings and scam heuristics are announced **before** the title, and the page is not auto-read. "Get me out" (F9 / voice) can't be intercepted by the page | `assistant.ts`, `url-safety.ts` | `assistant.test.ts` content-first suite |
| T8 | Trapping: beforeunload, fullscreen, dialog loops, popups | A1, A4 | Unload can't be prevented. Dialogs are auto-dismissed and announced. Fullscreen and popups are denied | `cdp-backend.ts`, `hardening.ts` | `chromium.integration.test.ts` dialogs |
| T9 | Page attacks local model endpoints (CSRF, DNS rebinding) | A1 | webRequest blocks public-origin to private-network requests, and any page request to configured AI or STT origins | `hardening.ts` | manual / backlog: e2e test in Electron CI |
| T10 | Key exfiltration | A1, A5 | Keys live only in the main process, encrypted by the OS keychain. Linux `basic_text` is refused. Keys are never sent over IPC to renderers | `secrets.ts`, `main.ts` | code review |
| T11 | Sensitive data sent to a cloud model | A3 | Consent per origin; sensitive categories called out; minimal chunks; redaction; audit log; per-site "never" | `privacy.ts` | `safety.test.ts` privacy |
| T12 | Hallucinated facts (dose, price, date) | A3 | Numbers in answers are checked against the source text, and unmatched ones are announced | `ai/verify.ts` | `safety.test.ts`, `assistant.test.ts` |
| T13 | Bot detection, or sites treating the agent as a bot | n/a | Trusted input events in the visible session at human pace; no headless use for user tasks | `cdp-backend.ts` | `chromium.integration.test.ts` trusted input |
| T14 | Stale Chromium (unpatched CVEs) | all | Electron security releases are shipped within 7 days, or the app announces it is out of date. The fork is gated on a 72-hour SLA | PLAN §4.1, chromium/README | release process |
| T15 | Certificate errors clicked through | A1, A4 | Never accepted; announced as a possible imposter | `hardening.ts` | manual |

## Known gaps (tracked in the backlog)

- No Safe Browsing equivalent yet (E5.12). Local heuristics are not enough on
  their own.
- Cross-origin iframes (payment widgets) aren't digested yet (E2.8, P0).
- No dual-LLM quarantine yet (E5.11). The policy layer is the backstop.
- No content/ad blocking yet (E6.8).
- Electron end-to-end tests for T9 can't run in this sandbox (the Electron
  binary can't be downloaded here). They need CI.
