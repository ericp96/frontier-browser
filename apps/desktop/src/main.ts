/**
 * Frontier Browser desktop shell.
 *
 * Two separate Chromium WebContents:
 *  - the SHELL (trusted): command box, conversation log, speech. Pages can't
 *    reach it, so browser messages can't be imitated by a page (AR-1).
 *  - the PAGE (untrusted): sandboxed, no preload, no Node, hardened session.
 *
 * The assistant runs here in the main process and drives the page over CDP
 * (webContents.debugger) using the same backend as the tests and CLI.
 */
import { app, BaseWindow, ipcMain, session, WebContentsView, type WebContents } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Assistant,
  AuditLog,
  CdpBackend,
  ConsentStore,
  PROVIDER_PRESETS,
  TranscriptionClient,
  createProvider,
  defaultConfig,
  parseConfig,
  type Announcement,
  type CdpTransport,
  type DeliveryResult,
  type FrontierConfig,
  type Output,
  type ProviderConfig,
  speakable,
  formatForLog,
  SPOKEN_DISCLAIMER,
} from '@frontier/core';
import { hardenApp, hardenPageContents, hardenWebSession } from './hardening.js';
import { SecretStore } from './secrets.js';
import { cleanUserAgent } from './ua.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHELL_DIR = join(here, '..', 'shell');
const HOME_URL = 'about:blank';

/** Set once the shell exists; until then, notifications are dropped. */
let notifyUser: (text: string) => void = () => undefined;

// ---- Config -----------------------------------------------------------------

const userData = () => app.getPath('userData');
const configPath = () => join(userData(), 'config.json');
const consentPath = () => join(userData(), 'ai-consent.json');

function loadConfig(): FrontierConfig {
  try {
    if (existsSync(configPath())) return parseConfig(readFileSync(configPath(), 'utf8'));
  } catch {
    /* fall back to defaults; never crash on a bad file */
  }
  return defaultConfig();
}

/** Persist config WITHOUT secrets. */
function saveConfig(cfg: FrontierConfig): void {
  const strip = <T extends { apiKey?: string } | null | undefined>(x: T): T => (x ? ({ ...x, apiKey: undefined } as T) : x);
  writeFileSync(configPath(), JSON.stringify({ ...cfg, ai: strip(cfg.ai), speechToText: strip(cfg.speechToText), textToSpeech: strip(cfg.textToSpeech) }, null, 2));
}

// ---- CDP transport over webContents.debugger ---------------------------------

function debuggerTransport(wc: WebContents): CdpTransport {
  const handlers = new Map<string, ((p: unknown) => void)[]>();
  wc.debugger.attach('1.3');
  wc.debugger.on('message', (_e, method, params) => {
    for (const h of handlers.get(method) ?? []) h(params);
  });
  return {
    send: (method, params) => wc.debugger.sendCommand(method, params ?? {}),
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  };
}

// ---- Output to the trusted shell -----------------------------------------------

class ShellOutput implements Output {
  private seq = 0;
  private waiting = new Map<number, (r: DeliveryResult) => void>();
  constructor(
    private readonly shell: WebContents,
    private readonly page: WebContents,
  ) {
    ipcMain.on('frontier:delivered', (e, id: number, result: DeliveryResult) => {
      if (e.sender !== this.shell) return;
      this.waiting.get(id)?.(result);
      this.waiting.delete(id);
    });
  }
  announce(a: Announcement): Promise<DeliveryResult> {
    // Mute the page while the browser asks a question, so page audio can't
    // answer it or talk over it (AR-3).
    if (a.kind === 'confirm') this.page.setAudioMuted(true);
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      // Core decides the framing ("The page says…") so a page can't sound like
      // Frontier in speech or in the log (review #1).
      this.shell.send('frontier:announce', id, { ...a, spoken: speakable(a), display: formatForLog(a) });
    });
  }
  interrupt(): void {
    this.shell.send('frontier:interrupt');
    for (const r of this.waiting.values()) r('interrupted');
    this.waiting.clear();
  }
  adjustRate(delta: number | 'reset'): void {
    this.shell.send('frontier:rate', delta);
  }
}

// ---- App ----------------------------------------------------------------------

async function createWindow(): Promise<void> {
  const config = loadConfig();
  const secrets = new SecretStore(join(userData(), 'secrets.json'));
  const originOf = (u: string | undefined, fallback = '') => {
    try {
      return u ? new URL(u).origin : fallback;
    } catch {
      return fallback;
    }
  };
  const aiOrigin = (c: ProviderConfig | null | undefined) => (!c ? '' : c.kind === 'anthropic' ? originOf(c.baseUrl, 'https://api.anthropic.com') : originOf(c.baseUrl));
  const withKey = (c: ProviderConfig | null | undefined): ProviderConfig | null => (c ? { ...c, apiKey: c.apiKey ?? secrets.get('ai', aiOrigin(c)) } : null);

  const win = new BaseWindow({ width: 1280, height: 860, title: 'Frontier Browser', backgroundColor: '#101418' });

  const shell = new WebContentsView({
    webPreferences: {
      preload: join(SHELL_DIR, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  const webSession = session.fromPartition('persist:web');
  const page = new WebContentsView({
    webPreferences: {
      session: webSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      autoplayPolicy: 'document-user-activation-required',
      safeDialogs: true,
      navigateOnDragDrop: false,
      // Spellcheck would download dictionaries from Google; we promise no
      // network traffic beyond the pages the user visits.
      spellcheck: false,
    },
  });
  win.contentView.addChildView(page);
  win.contentView.addChildView(shell);
  const layout = () => {
    const { width, height } = win.getContentBounds();
    const panel = Math.max(380, Math.round(width * 0.34));
    shell.setBounds({ x: 0, y: 0, width: panel, height });
    page.setBounds({ x: panel, y: 0, width: width - panel, height });
  };
  layout();
  win.on('resize', layout);

  const notify = (text: string) => notifyUser(text);
  const protectedOrigins = () =>
    [config.ai && 'baseUrl' in config.ai ? config.ai.baseUrl : undefined, config.speechToText?.baseUrl, config.textToSpeech?.baseUrl]
      .filter((u): u is string => !!u)
      .map((u) => {
        try {
          return new URL(u).origin;
        } catch {
          return '';
        }
      });
  hardenWebSession(webSession, { notify, protectedOrigins });
  hardenPageContents(page.webContents, { notify, protectedOrigins, openInPlace: (u) => void backend.navigate(u) });

  // The shell is a local file and must never navigate anywhere.
  shell.webContents.on('will-navigate', (e) => e.preventDefault());
  shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Microphone only for the trusted shell (push-to-talk).
  shell.webContents.session.setSpellCheckerEnabled(false);
  shell.webContents.session.setSpellCheckerDictionaryDownloadURL('https://0.0.0.0/');
  shell.webContents.session.setPermissionRequestHandler((wc, permission, cb) => cb(wc === shell.webContents && permission === 'media'));


  const output = new ShellOutput(shell.webContents, page.webContents);
  notifyUser = (text) => void output.announce({ text, kind: 'alert', source: 'browser' });
  // CDP commands only get answered once the page view has a renderer, so
  // give it an empty document before attaching the debugger.
  await page.webContents.loadURL(HOME_URL);
  const backend = new CdpBackend(debuggerTransport(page.webContents));
  await backend.init();
  const consent = new ConsentStore(existsSync(consentPath()) ? (JSON.parse(readFileSync(consentPath(), 'utf8')) as Record<string, 'always' | 'never'>) : {});
  const assistant = new Assistant({
    backend,
    output,
    provider: createProvider(withKey(config.ai)),
    consent,
    audit: new AuditLog(),
    settings: { ...config.settings, homeUrl: HOME_URL },
  });
  const stt = () => (config.speechToText ? new TranscriptionClient({ ...config.speechToText, apiKey: config.speechToText.apiKey ?? secrets.get('speechToText', originOf(config.speechToText.baseUrl)) }) : null);

  // Keys the page can never intercept: handled before the page sees them (AR-8, AR-11).
  const keys = (e: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F9') {
      e.preventDefault();
      void assistant.handle('get me out');
    } else if (input.key === 'F4') {
      e.preventDefault();
      void assistant.handle('stop');
    } else if (input.key === 'F3' || (input.key === 'F6' && !input.shift)) {
      e.preventDefault();
      shell.webContents.focus();
      shell.webContents.send('frontier:focus-command');
    } else if (input.key === 'F6' && input.shift) {
      e.preventDefault();
      page.webContents.focus();
    }
  };
  page.webContents.on('before-input-event', keys);
  shell.webContents.on('before-input-event', keys);

  ipcMain.handle('frontier:command', async (e, text: unknown) => {
    if (e.sender !== shell.webContents || typeof text !== 'string') return;
    page.webContents.setAudioMuted(false);
    try {
      await assistant.handle(text.slice(0, 2000));
    } finally {
      if (assistant.awaitingAnswer) page.webContents.setAudioMuted(true);
      writeFileSync(consentPath(), JSON.stringify(consent.toJSON()));
    }
  });

  ipcMain.handle('frontier:audio', async (e, audio: unknown) => {
    if (e.sender !== shell.webContents || !(audio instanceof Uint8Array)) return null;
    const client = stt();
    if (!client) {
      notify('Speech recognition is not set up. Type your command, or add a speech service in Settings.');
      return null;
    }
    try {
      const text = await client.transcribe(new Blob([new Uint8Array(audio)], { type: "audio/webm" }));
      return text || null;
    } catch (err) {
      notify((err as Error).message);
      return null;
    }
  });

  ipcMain.handle('frontier:get-settings', (e) => {
    if (e.sender !== shell.webContents) return null;
    // Never send secrets to a renderer — only whether one is set.
    const strip = (c: { apiKey?: string } | null | undefined) => (c ? { ...c, apiKey: undefined } : null);
    return {
      settings: assistant.settings,
      ai: strip(config.ai),
      speechToText: strip(config.speechToText),
      hasKey: { ai: secrets.hasFor('ai', aiOrigin(config.ai)), speechToText: secrets.hasFor('speechToText', originOf(config.speechToText?.baseUrl)) },
      presets: PROVIDER_PRESETS,
      keyStorageProblem: secrets.unavailableReason(),
    };
  });

  ipcMain.handle('frontier:save-settings', (e, raw: unknown) => {
    if (e.sender !== shell.webContents) return { ok: false };
    try {
      const incoming = raw as { settings?: unknown; ai?: { apiKey?: string } | null; speechToText?: { apiKey?: string } | null };
      const next = parseConfig(JSON.stringify({ version: 1, ...incoming }));
      if (incoming.ai?.apiKey) secrets.set('ai', incoming.ai.apiKey, aiOrigin(next.ai));
      if (incoming.speechToText?.apiKey) secrets.set('speechToText', incoming.speechToText.apiKey, originOf(next.speechToText?.baseUrl));
      Object.assign(config, next, { settings: { ...config.settings, ...next.settings } });
      Object.assign(assistant.settings, next.settings);
      assistant.provider = createProvider(withKey(config.ai));
      saveConfig(config);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  // Load the shell only now: it calls frontier:get-settings as soon as it
  // starts, so every IPC handler must already be registered. Announcements
  // below need it loaded.
  await shell.webContents.loadFile(join(SHELL_DIR, 'shell.html'));

  // A helper can hand the user a setup file: frontier --import-config setup.json (AR-10).
  const importArg = process.argv.indexOf('--import-config');
  if (importArg > 0 && process.argv[importArg + 1]) {
    try {
      const imported = parseConfig(readFileSync(process.argv[importArg + 1]!, 'utf8'));
      if (imported.ai?.apiKey) secrets.set('ai', imported.ai.apiKey, aiOrigin(imported.ai));
      if (imported.speechToText?.apiKey) secrets.set('speechToText', imported.speechToText.apiKey, originOf(imported.speechToText.baseUrl));
      Object.assign(config, imported);
      saveConfig(config);
      assistant.provider = createProvider(withKey(config.ai));
      Object.assign(assistant.settings, imported.settings);
      notify('Your setup file was imported. Any keys in it are now stored securely; the setup file can be deleted.');
    } catch (err) {
      notify(`I couldn't import the setup file: ${(err as Error).message}`);
    }
  }

  // Speaks with zero configuration on first launch (AR-10).
  await output.announce({
    text: `Welcome to Frontier Browser. ${assistant.provider ? `Your AI is ${assistant.provider.label}.` : 'No AI model is connected, and every basic command still works.'} Type a command, or hold F2 to speak. Say "help" at any time. F9 always gets you out of a page.`,
    kind: 'info',
    source: 'browser',
  });
  // Spoken on every launch: a blind user may never open DISCLAIMER.md.
  await output.announce({ text: SPOKEN_DISCLAIMER, kind: 'alert', source: 'browser' });
  // The project never publishes installers. A packaged copy came from
  // someone else and may be modified or out of date.
  if (app.isPackaged) {
    await output.announce({
      text: 'Warning: this is an unofficial packaged copy of Frontier. The Frontier project does not publish installers, so this copy was made by someone else and may be modified, unsafe, or out of date.',
      kind: 'alert',
      source: 'browser',
    });
  }
  await page.webContents.loadURL(HOME_URL);
}

hardenApp({ notify: (t) => notifyUser(t), protectedOrigins: () => [] });
app.enableSandbox();
// The app-wide default user agent wins over the session's, so clean it here
// too. Found by running the app: pages saw "@frontier/desktop … Electron/…",
// which could reveal that the user relies on assistive technology.
app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
