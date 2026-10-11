# Security Policy

Frontier's users are often targeted by scams and can't easily spot a
compromised browser, so we treat security reports as urgent.

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
- **Our targets:** acknowledge within 3 days. Fix critical issues within 7
  days. Ship each Electron security release within 7 days of publication.
- The threat model is in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
