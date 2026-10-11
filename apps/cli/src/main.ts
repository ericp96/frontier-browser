#!/usr/bin/env node
/**
 * frontier — a text-mode Frontier Browser.
 *
 * Drives a real Chromium window (or headless) through the same CDP backend
 * and assistant as the desktop app. Everything is plain text on stdout, so it
 * works with terminal screen readers (Orca, NVDA, VoiceOver, Speakup) and
 * braille displays (BRLTTY), and over SSH.
 *
 *   frontier [url] [--headless] [--config path] [--chromium path] [--terse]
 */
import { readFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { chromium } from 'playwright-core';
import {
  Assistant,
  CdpBackend,
  createProvider,
  parseConfig,
  formatForLog,
  type Announcement,
  type CdpTransport,
  type DeliveryResult,
  type Output,
  type FrontierConfig,
  SPOKEN_DISCLAIMER,
} from '@frontier/core';

interface Args {
  url?: string;
  headless: boolean;
  config?: string;
  chromium?: string;
  terse: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { headless: false, terse: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    if (v === '--headless') a.headless = true;
    else if (v === '--terse') a.terse = true;
    else if (v === '--config') a.config = argv[++i];
    else if (v === '--chromium') a.chromium = argv[++i];
    else if (v === '--help' || v === '-h') {
      process.stdout.write('Usage: frontier [url] [--headless] [--terse] [--config file.json] [--chromium /path/to/chrome]\n');
      process.exit(0);
    } else a.url = v;
  }
  return a;
}

/** Plain-text output. One line per message, prefixed so sources are unambiguous (AR-1). */
class TerminalOutput implements Output {
  async announce(a: Announcement): Promise<DeliveryResult> {
    const tag = a.source === 'browser' ? (a.kind === 'confirm' ? '[frontier asks]' : a.kind === 'alert' || a.kind === 'error' ? '[frontier alert]' : '[frontier]') : a.source === 'ai' ? '[ai]' : '[page]';
    process.stdout.write(`${tag} ${formatForLog(a).replace(/^(AI: |Frontier asks: )/, '')}\n`);
    return 'done';
  }
  interrupt(): void {
    /* text output can't be interrupted mid-line */
  }
}

function findChromium(explicit?: string): string | undefined {
  const candidates = [explicit, process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'C:\\Program Files\\Chromium\\Application\\chrome.exe'];
  return candidates.find((c): c is string => !!c && existsSync(c));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let config: FrontierConfig = { version: 1 };
  if (args.config) config = parseConfig(readFileSync(args.config, 'utf8'));
  const exe = findChromium(args.chromium);
  const browser = await chromium.launch({ headless: args.headless, executablePath: exe, args: ['--force-renderer-accessibility'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const backend = new CdpBackend(session as unknown as CdpTransport);
  await backend.init();
  const output = new TerminalOutput();
  const assistant = new Assistant({
    backend,
    output,
    provider: createProvider(config.ai),
    settings: { profile: 'screen-reader', ...config.settings, ...(args.terse ? { verbosity: 'terse' } : {}) },
  });

  process.stdout.write(`[frontier] Frontier Browser. Type a command, or "help". ${assistant.provider ? `AI: ${assistant.provider.label}.` : 'No AI model connected; all commands work offline.'} Type "quit" to exit.\n`);
  process.stdout.write(`[frontier alert] ${SPOKEN_DISCLAIMER}\n`);
  if (args.url) await assistant.handle(`go to ${args.url}`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ', terminal: process.stdin.isTTY });
  rl.prompt();
  // Commands run one at a time, in order. A command that is waiting for the
  // user's answer (confirmation, consent, choice) releases the queue so the
  // answer can be delivered.
  let queue: Promise<void> = Promise.resolve();
  const waitingOrDone = (p: Promise<void>) =>
    new Promise<void>((resolve) => {
      void p.finally(resolve);
      const t = setInterval(() => {
        if (assistant.awaitingAnswer) {
          clearInterval(t);
          resolve();
        }
      }, 20);
      void p.finally(() => clearInterval(t));
    });
  rl.on('line', (line) => {
    const t = line.trim();
    queue = queue.then(async () => {
      if (t === 'quit' || t === 'exit') {
        rl.close();
        return;
      }
      const p = assistant.handle(t).catch((e: Error) => void output.announce({ text: e.message, kind: 'error', source: 'browser' }));
      await waitingOrDone(p);
      rl.prompt();
    });
  });
  rl.on('close', async () => {
    await queue;
    assistant.dispose();
    await browser.close();
    process.exit(0);
  });
}

main().catch((e: Error) => {
  process.stderr.write(`[frontier alert] ${e.message}\n`);
  if (/Executable doesn't exist|executable/i.test(e.message)) process.stderr.write('[frontier] Install Chromium, or pass --chromium /path/to/chrome.\n');
  process.exit(1);
});
