# The native Chromium fork (Phase 3, gated)

Frontier is built on Chromium today through the Electron shell (`apps/desktop`),
which **is** Chromium's content layer, Blink, V8 and accessibility tree. This
directory holds a native fork, managed the way Brave and ungoogled-chromium
manage theirs:

| File | Purpose |
|---|---|
| `CHROMIUM_VERSION` | The pinned Chromium release. It is the version our integration tests run against (141.0.7390.37). |
| `args.gn` | Build flags: no Google API keys, no Widevine, no proprietary codecs (pending a legal decision), and Safe Browsing replaced. This is a starting point and must be checked against the pinned version's `gn args --list`. |
| `patches/series` | An ordered patch series against that version. The planned patches are listed there. |
| `scripts/fetch.sh` | Fetches depot_tools and the pinned source. Needs about 100 GB of disk. |
| `scripts/apply-patches.sh` | Applies the series and fails on any conflict. |
| `scripts/build.sh` | Runs `gn gen` and `autoninja`. Takes hours on a large machine. |

This repository never vendors Chromium's source. Doing so would make it
roughly 40 GB and impossible to review. Every change we make to Chromium
lives in `patches/` and can be read on its own.

## Why the fork is gated (adversarial review AR-7)

A browser fork that falls behind on security fixes puts its users at risk,
and our users are among the most targeted. Volunteer forks routinely lag
Chrome's security releases. So **nothing ships from this directory** until
all of the following are true:

1. **There is a named capability that Electron or an extension can't
   provide.** It must be written down with evidence. Examples: a
   browser-process accessibility service, native side-panel UI, or a
   Google-free build policy that Electron can't express.
2. **Funding** covers at least 2 full-time Chromium engineers for 3 years.
   It must not come from user fees.
3. **Security SLA:** each Chrome stable security release is rebased, built,
   signed and shipped within **72 hours**. This must be proven over 3
   consecutive releases in CI before launch.
4. **Infrastructure exists:** reproducible CI builds on large runners,
   signing for all 3 OSes, an update server, and a crash pipeline that is
   opt-in and has a DPIA.
5. **The user advisory panel has signed off.**

Until then, the default is to **contribute upstream**: accessibility fixes go
to Chromium, and hardening fixes go to Electron. Frontier ships on Electron.

## How the core runs inside the fork

`packages/core` is TypeScript and depends only on the `BrowserBackend`
interface. In the native build:

- The assistant runs in a trusted WebUI (`chrome://frontier`) hosted in the
  side panel. This is the same trusted-surface model the Electron shell uses.
- It reaches the active tab through a small browser-process Mojo service.
  The service exposes the subset of CDP that `CdpBackend` uses (isolated
  world, Accessibility, Input, Page), so `CdpBackend` runs unchanged on top
  of a Mojo transport.
- Speech uses the platform TTS through `content::TtsController`. Speech
  recognition stays bring-your-own; we do not use Google's servers.
