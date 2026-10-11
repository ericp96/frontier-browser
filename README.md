# Frontier Browser

**A free, open-source, voice-first web browser for blind, low-vision and
deafblind people.** It is built on Chromium. You can back it with your own AI
model, or use no AI at all.

> [!WARNING]
> **Experimental, unmaintained side project. No warranty, no support, no
> guarantee of compliance with any law or accessibility standard.** It has not
> been tested by blind users or audited, and it may not receive security
> updates. Don't rely on it as your only way to access the web, or for
> medical, legal, financial or emergency matters. Using it means you accept the
> [Disclaimer and Release of Liability](DISCLAIMER.md) and the
> [licence](LICENSE).

Being blind should not mean paying a premium to use the web. Frontier is
designed never to charge for an accessibility feature, never to resell AI,
and never to track you.

A real session with the text-mode version, using a test page from this
repository:

```
> go to http://127.0.0.1:8765/article.html
[frontier] How to Grow Tomatoes | Garden News. Article, about 1 minute to read.
[page] Tomatoes need at least six hours of direct sunlight every day. Choose the sunniest spot in your garden.
[page] Heading: Planting
…
> go to http://127.0.0.1:8765/signup.html
[frontier] Create your account - Example Shop. Form with 7 fields.
[frontier alert] The box "Send me marketing offers and newsletters" was already checked for you.
> fill email with ada at example dot org
[frontier] Email address set to ada@example.org.
> submit
[frontier asks] Confirm: submit "Create account" on 127.0.0.1 … To go ahead, say or type "confirm rocket". To stop, say "cancel".
> yes
[frontier asks] I didn't hear the word. To go ahead, say "confirm rocket". To stop, say "cancel".
> get me out
[frontier alert] You're safe. I closed that page and went to your home page. Nothing on that page was submitted.
```

## What it does

- **Content first.** When a page opens you hear:
  1. any safety warnings
  2. the title and the kind of page ("Article, about 4 minutes to read")
  3. the content itself

  For search results, the content is the top results. For a form, it's the
  list of fields.
- **Natural commands, with or without AI.** About 50 built-in commands work
  offline with no AI model:
  - "read", "continue", "stop"
  - "headings", "next link", "click the third link"
  - "fill email with sam at example dot com", "submit"
  - "search for…", "what can I do here", "where am I"

  Connect a model and you can also ask in your own words.
- **Bring your own model.** Supported:
  - Ollama, LM Studio, llama.cpp, vLLM, OpenRouter, OpenAI, or any
    OpenAI-compatible server
  - Anthropic Claude

  Small local models without tool calling work through a simple JSON
  protocol.
- **Safety features (best effort — they can miss things).**
  - Actions that cost money, post, send or delete are designed to need your
    confirmation. High-risk actions need a random challenge word, not just
    "yes".
  - It is designed so web pages can't give the assistant orders, imitate
    Frontier's voice prompts, or tell that you use assistive technology.
  - Lookalike sites and tech-support scams it recognises are announced
    *before* the page is read. No warning doesn't mean a site is safe.
  - **"Get me out"** (or F9) closes the page.
- **Private.** No telemetry, no account. Pages go to a cloud AI only if you
  set one up, and only after you say yes for that site. Say "what did you
  send" to check.
- **Works with your screen reader, or without one.** Three profiles:
  - **Voice:** Frontier speaks.
  - **Screen reader:** Frontier stays quiet and your NVDA, JAWS, VoiceOver
    or Orca reads its log.
  - **Braille:** text only, no sound, no timeouts.

## Status

This is an early, experimental foundation that is **not actively
maintained**. See [DISCLAIMER.md](DISCLAIMER.md). For the details:

- [docs/PLAN.md](docs/PLAN.md): the plan
- [docs/ADVERSARIAL_REVIEW.md](docs/ADVERSARIAL_REVIEW.md): the
  adversarial review that changed the plan
- [docs/BACKLOG.md](docs/BACKLOG.md): what is and isn't done

**It has not yet been tested with blind users.** That is the next
milestone, and their judgement overrides ours.

## Try it (from source only)

This project is **academic and experimental**. It publishes **no installers,
binaries or packages**, and never will: every package is private, and CI fails
if packaging or publishing is added (`npm run check:distribution`). If you find
a "Frontier Browser" download somewhere, it is unofficial. See
[DISCLAIMER.md](DISCLAIMER.md).

You need Node 20+ and Chromium (or Chrome).

```bash
npm install
npm run build -w @frontier/core

# Text-mode browser in your terminal (works with screen readers, braille and SSH)
npm run build -w @frontier/cli
node apps/cli/dist/main.js https://example.com            # opens a visible Chromium window
node apps/cli/dist/main.js https://example.com --headless # text only

# The desktop app (Electron)
npm run desktop
```

The CLI finds Chromium automatically. If it doesn't, pass
`--chromium /path/to/chrome`.

## Connect an AI model (optional)

The easiest private option is to install [Ollama](https://ollama.com) and run
`ollama pull llama3.2`. Then choose "Ollama" in Settings, or give the CLI a
config file:

```json
{
  "version": 1,
  "ai": { "kind": "openai-compatible", "baseUrl": "http://127.0.0.1:11434/v1", "model": "llama3.2" },
  "speechToText": { "baseUrl": "http://127.0.0.1:8080/v1" }
}
```

```bash
node apps/cli/dist/main.js --config frontier.json
# Desktop: a family member or helper can prepare this file for you
npm run build -w @frontier/desktop
npx electron apps/desktop --import-config frontier.json
```

For Claude, use `{ "kind": "anthropic", "apiKey": "…" }`. In the desktop
app, keys are stored in your system keychain and never shown again.

### Keep your local AI private (Ollama and similar)

Local model servers have no password, so any program on your computer can
use them. Frontier blocks web pages from reaching them, but other browsers
don't. Two settings keep Ollama safe:

- Keep `OLLAMA_HOST` at its default, `127.0.0.1`. Never set it to `0.0.0.0`
  on a shared network.
- Leave `OLLAMA_ORIGINS` unset, or set it to the smallest list you need.
  Never use `*`.

## Repository layout

| Path | What |
|---|---|
| `packages/core` | The engine. It doesn't depend on Electron or any other browser shell. Contains: <ul><li>page agent</li><li>command grammar</li><li>safety gate and policy</li><li>privacy controls</li><li>AI providers and planner</li><li>CDP backend</li><li>assistant</li></ul> |
| `apps/desktop` | The Electron shell: a trusted UI panel next to a sandboxed page, with hardened defaults |
| `apps/cli` | Text-mode Frontier over Playwright/Chromium |
| `chromium/` | The native Chromium fork as a patch series. Gated: see its README |
| `docs/` | Plan, backlog, review, compliance, threat model, hotkeys, privacy, accessibility |

## Development

```bash
npm run typecheck
npx vitest run --project unit          # fast, no browser needed
npx vitest run --project integration   # real Chromium; set CHROMIUM_PATH if needed
npm run build && FRONTIER_E2E=1 xvfb-run -a npx vitest run --project electron
                                       # the real desktop app; Linux, non-root, needs xvfb and xdotool
```

The Electron tests launch the built desktop app with Chromium's sandbox on
and use it the way a person would, by typing commands into the shell. They
check what it says back, what the page can see, and that a real F9 key
press gets you out even when focus is inside the page.

The integration tests drive real Chromium through the same CDP code the
desktop app uses. They prove that:

- the page can't see the agent or lie to it
- names match Chromium's accessibility tree
- clicks and typing are trusted input
- dialogs and unload traps are neutralised
- a full read-skim-fill-confirm-submit flow works
- the shell passes an automated WCAG 2.2 AA audit

## Licence

[MPL-2.0](LICENSE), provided "as is" without warranty; see Sections 6 and 7
of the licence and the [Disclaimer and Release of Liability](DISCLAIMER.md).
Third-party notices are in [NOTICE](NOTICE). Security reports:
[SECURITY.md](SECURITY.md).
