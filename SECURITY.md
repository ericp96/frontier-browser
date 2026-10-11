# Security Policy

> **This is an unmaintained side project.** There is no security team, no
> response commitment, and no guarantee that any vulnerability will ever be
> fixed or that released builds contain current security patches. Do not use
> it where a security failure would harm you. See [DISCLAIMER.md](DISCLAIMER.md).

Frontier's users are often targeted by scams and can't easily spot a
compromised browser, so reports are still very welcome.

- **Report privately** through GitHub's "Report a vulnerability" (security
  advisories) on this repository. Please don't open public issues for
  vulnerabilities.
- **Especially in scope:**
  - a page that can imitate Frontier's own prompts
  - prompt injection that gets past the policy layer or the confirmation gate
  - reaching local or private-network services from a page
  - leaking API keys
  - detecting that the user uses assistive technology
  - an unpatched Chromium/Electron CVE in a released build
- **Response:** best effort only, when and if the maintainer is available.
  The timelines in `docs/PLAN.md` (for example, shipping Electron security
  releases within 7 days) are goals for a future funded effort, not
  commitments.
- The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
