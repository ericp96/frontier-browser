# Privacy and AI Transparency Notice

This notice is spoken during onboarding. You can hear it again at any time
by saying "privacy".

This notice describes how Frontier is designed to behave. It is provided
without warranty; see [DISCLAIMER.md](../DISCLAIMER.md).

**Short version.** Frontier doesn't collect anything about you. It sends
your pages to an AI only if you connect one, and only after you say it may,
site by site.

- **No tracking, no telemetry, no account.** Frontier never sends usage
  data, crash reports or analytics anywhere. Your history and settings stay
  on your computer.
- **Websites aren't told you use Frontier.** Frontier hides from the pages
  you visit, so a site can't tell that you use assistive technology.
- **AI is optional, and you choose it.** If you connect an AI model, you
  pick it. When it runs on your own computer (Ollama, LM Studio,
  llama.cpp), nothing leaves your machine. When it's a cloud service, the
  first time you ask about a site Frontier asks whether it may send that
  site to the service: "once", "always", or "never". Banking, health,
  email and government sites are called out when you're asked.
- **Only what's needed is sent.** Frontier sends the parts of the page
  related to your question, not the whole page. Before anything leaves your
  computer it removes card numbers, ID numbers and one-time codes, and
  password fields are never included.
- **You can check.** Say "what did you send" to hear what was sent, when,
  and to whom. Say "never send this site to the AI" to block a site.
- **AI answers are labelled.** Anything an AI model wrote is introduced as
  "AI". Summaries are called summaries. If the AI gives a number, price,
  dose or date that Frontier can't find on the page, Frontier warns you.
- **AI isn't a professional.** For medical, legal or money questions, the
  AI reports what the page says. It is not advice. Check important details
  with a person you trust or a professional.
- **Your voice.** Push-to-talk records only while you hold the key. The
  recording goes to the speech service you chose, and Frontier doesn't keep
  it. Frontier never builds a voiceprint.
- **Your keys.** API keys are stored in your system's secure keychain and
  are never shown again.

The terminal version of Frontier runs on whatever Chromium or Chrome is
installed on your computer, and stock Chromium contacts Google on its own
(for example to check sign-in status). Frontier switches off what it can,
but for the strictest privacy use a de-Googled build such as
ungoogled-chromium with `--chromium /path/to/it`.

If you use a cloud AI or speech service, that company's own privacy policy
and terms apply to what you send it. Some services don't allow users under
13 or 18.
