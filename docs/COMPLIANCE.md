# Compliance and Obligations Matrix

> **Status:** an engineering analysis written so that counsel can review it
> before Phase 1. **It is not legal advice.** Each "Open" item needs a
> decision from a qualified lawyer in the relevant jurisdiction.

## 1. Our role, in one paragraph

Frontier is free, open-source software that runs on the user's device. By
default it collects nothing and sends nothing except the web pages the user
visits. The user may choose to connect an AI model or speech service they
select. When they do, *they* choose that processor and send the data to it
under that provider's terms. We neither operate nor resell any of these
services. This makes the Frontier project, in most frameworks, a **software
supplier rather than a data controller** for what happens on the user's
device.

That position only holds if we (a) collect nothing ourselves, (b) make every
transfer to a third party visible, and (c) let the user stop or audit those
transfers. The controls below exist to keep it true.

## 2. Standing policies (they bind every future change)

| ID | Policy | Why |
|---|---|---|
| P-1 | **No telemetry, including opt-in telemetry, until a DPIA is complete.** Crash reports are local only. | Using this app implies the user is disabled, and disability is special-category data under GDPR Art. 9. |
| P-2 | **No speaker identification, voice enrolment or voiceprints.** Speech-to-text only, and only through the user's chosen endpoint. | Keeps the app out of BIPA, CUBI, Texas and similar biometric-identifier regimes. |
| P-3 | **No accessibility feature behind payment.** | This is the project's mission. It also avoids consumer-protection problems with paid accessibility. |
| P-4 | **Pages are never told the user is using assistive technology.** The agent runs in an isolated world, writes no DOM markers, and the user-agent string carries no Frontier or Electron marker. | Detecting assistive technology reveals disability. W3C deliberately does not expose it. |
| P-5 | **AI output is always labelled as AI.** Summaries are labelled as summaries. Numbers the model gives that we can't find in the page are announced as unverified. | EU AI Act Art. 50 transparency; avoiding user harm. |
| P-6 | **AI output is not professional advice.** The model is instructed to report what a page says, not to advise. | Medical, legal and financial liability. |

## 3. Obligation matrix by feature

| Feature | Data involved | Framework | Our role | Required control | Status |
|---|---|---|---|---|---|
| Shell UI (command box, log, settings) | none | **WCAG 2.2 AA**; **EN 301 549 v3.2.1** cl. 11 (software) and cl. 4.2 functional performance statements; **Section 508** (procurement) | Software supplier | Automated axe-core WCAG 2.2 AA audit in CI. Manual audit with NVDA, JAWS, VoiceOver, Narrator and Orca. Publish an ACR / VPAT 2.5 (E8.2). FPS 4.2.1 (no vision), 4.2.2 (limited vision), 4.2.4 (no hearing: braille profile, text log), 4.2.6 (no speech: typed input), 4.2.8 (limited reach: full voice and keyboard), 4.2.10 (limited cognition: guided mode) | Automated audit ✅ in CI; manual audit and ACR open |
| Page reading and digest | page content, on device | none beyond the browser itself | n/a | Agent in an isolated world; nothing persisted | ✅ |
| AI questions and tasks (cloud model) | parts of a page, which may include personal data of the user **and of third parties** (for example email correspondents) | **GDPR** Art. 5(1)(c) minimisation, Art. 9, Art. 44+ transfers; **CCPA/CPRA** sensitive PI; provider terms | User-chosen processor. We are not the controller provided P-1 holds | Ask once per origin; sensitive site categories called out in the prompt; minimal relevant chunks only; on-device redaction of card, ID and OTP data; "what did you send" log, capped; per-site "never" | ✅ code. Open: the provider wizard must show each provider's retention and training policy (E7.5) |
| AI questions (local model) | stays on the device or LAN | none | n/a | No consent prompt needed, but still logged | ✅ |
| AI interaction disclosure | n/a | **EU AI Act (Reg. 2024/1689) Art. 50(1)**, in force 2 Aug 2026: people must be told they are interacting with an AI system | Probably a *provider* of an AI system that integrates a third-party model. **Open:** counsel to confirm | AI output is prefixed "AI:" in speech and the log; onboarding explains it | ✅. Open: legal confirmation of role, and whether the Art. 50(2) marking of synthetic text applies or the assistive "standard editing" exception covers it |
| Voice input | audio of the user's voice | **GDPR** (personal data); **BIPA/CUBI** only if voiceprints are made (P-2 prevents this) | User-chosen processor | Push-to-talk only, never always-on. Audio goes to the user's STT endpoint and is not stored by us. Wake word (P2) must run on the device only | ✅ |
| API keys | secrets | security good practice | n/a | OS keychain only, never sent to renderers. We refuse to store keys under Linux `basic_text` | ✅ |
| Children | any | **COPPA** (US, under 13), **GDPR** Art. 8 | n/a: we collect nothing | Show each provider's minimum-age term in the AI wizard (some require 13+ or 18+) | Open (E7.5) |
| Web automation by the agent | user's own sessions | site Terms of Service; computer-misuse law; **ADA/EAA** arguments for assistive use | User's agent | Only visible, user-initiated, human-paced actions with trusted input. No background scraping. Confirmation for consequential actions | ✅ code. Open: legal position memo (E8.12) |
| Media playback | none | **H.264/AAC patent pools** for distributing proprietary codecs | Distributor | Electron ships proprietary codecs by default, so a decision is needed per distribution channel. The native build defaults to `proprietary_codecs=false` | **Open (E8.8)** |
| DRM streaming (Netflix and similar) | none | Widevine licence from Google | n/a | No Widevine in Electron or in our build. **We tell users honestly** that DRM streaming services won't play, which matters because audio-described streaming is a major use case. Evaluate the castlabs ECS route | **Open (E8.9)** |
| Bundled models (future) | none | model licences (Llama Community, Gemma terms, …) | Distributor | Licence review gate before anything is bundled. Whisper (MIT) is fine | Gate defined (E8.10) |
| Encryption in the software | n/a | **US EAR** §742.15 / License Exception ENC | Exporter of publicly available source | Confirm that the 2021 EAR amendments remove the notification requirement for publicly available standard cryptography. We use only platform and Chromium TLS | Open (E8.11) |
| Names and branding | n/a | trademark | n/a | "Chromium" is used only descriptively. Never use Google "Chrome" marks or logos | ✅ |
| Distribution and licences | n/a | MPL-2.0 (ours); BSD-3-Clause (Chromium); MIT (Electron, jsdom, Anthropic SDK); Apache-2.0 (Playwright, TypeScript); MPL-2.0 (axe-core, dev only) | Distributor | `NOTICE` file. Ship Chromium's `about:credits` with installers | ✅ NOTICE; installer credits open |

## 4. Accessibility law: where it applies

- **European Accessibility Act** (Directive 2019/882, applying from 28 June
  2025): web browsers are not a named product category, and free
  non-commercial software is probably out of scope. Organisations that deploy
  Frontier (libraries, employers) will still ask for **EN 301 549** evidence,
  so we treat EN 301 549 as our bar.
- **ADA** (US): Title III covers public accommodations, and Title II (the
  2024 DOJ rule) requires state and local government web content to meet
  WCAG 2.1 AA. Frontier is a tool, not a covered entity, but public
  institutions deploying it need our ACR.
- **Section 508**: applies to federal procurement. The ACR / VPAT is the
  artefact they need.

## 5. Before Phase 1 exits

1. Counsel reviews this matrix and closes or accepts each "Open" row.
2. A DPIA is written, even though P-1 means nothing is collected. It
   documents why, and what would change if we ever collected anything.
3. ACR / VPAT 2.5 is drafted for the shell, with a manual assistive-technology
   audit across the five screen readers.
4. A privacy notice and an AI transparency notice are spoken during
   onboarding (see [PRIVACY.md](PRIVACY.md)).
5. The accessibility statement and feedback channel are published (see
   [ACCESSIBILITY.md](ACCESSIBILITY.md)).
