/**
 * Security baseline for showing arbitrary web content in Electron (AR-4, AR-11, AR-13).
 * Every rule here is enforced by the browser process; pages can't opt out.
 */
import { app, type Session, type WebContents } from 'electron';
import { isPrivateHost, siteOf } from '@frontier/core';
import { cleanUserAgent } from './ua.js';

export interface HardeningHooks {
  /** Tell the user something happened (permission denied, popup blocked…). */
  notify(text: string): void;
  /** Origins of the user's configured AI/speech endpoints. Pages may never call them. */
  protectedOrigins(): string[];
}


const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'about:']);

export function hardenWebSession(ses: Session, hooks: HardeningHooks): void {
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  // No silent calls to Google: spellcheck dictionaries come from
  // redirector.gvt1.com (found by running the app with egress logging).
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerDictionaryDownloadURL('https://0.0.0.0/');

  // Deny-by-default permissions, announced so the user knows why something
  // isn't working. (Per-site "allow" by voice: backlog E5.13.)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const site = siteOf(details.requestingUrl ?? wc.getURL()) || 'This page';
    if (permission !== 'clipboard-sanitized-write') {
      hooks.notify(`${site} asked to use ${describePermission(permission)}. I said no.`);
    }
    callback(permission === 'clipboard-sanitized-write');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');

  // Pages may not reach the local network or the user's model endpoints (DNS
  // rebinding / CSRF against Ollama et al., AR-13). Top-level navigations the
  // user asked for are allowed (people do browse their router or localhost).
  ses.webRequest.onBeforeRequest((details, callback) => {
    let target: URL;
    try {
      target = new URL(details.url);
    } catch {
      return callback({ cancel: true });
    }
    if (details.resourceType === 'mainFrame') {
      return callback({ cancel: !ALLOWED_SCHEMES.has(target.protocol) && target.protocol !== 'blob:' });
    }
    const initiator = (() => {
      try {
        return new URL(details.referrer || details.frame?.url || '');
      } catch {
        return null;
      }
    })();
    const fromPublic = !initiator || !isPrivateHost(initiator.hostname);
    if (fromPublic && isPrivateHost(target.hostname)) return callback({ cancel: true });
    if (hooks.protectedOrigins().includes(target.origin) && initiator?.origin !== target.origin) return callback({ cancel: true });
    callback({});
  });

  ses.on('will-download', (_e, item) => {
    // File names are page-controlled: clip them before they enter a trusted message.
    const name = item.getFilename().replace(/["“”]/g, '').slice(0, 60);
    hooks.notify(`Downloading a file named ${name}. I'll tell you when it's finished.`);
    item.once('done', (_ev, state) => {
      hooks.notify(state === 'completed' ? `Download finished: ${name}, in your Downloads folder.` : `The download of ${name} did not finish.`);
    });
  });
}

export function hardenPageContents(wc: WebContents, hooks: HardeningHooks & { openInPlace(url: string): void }): void {
  // No popups or new windows; tell the user where it wanted to go.
  wc.setWindowOpenHandler(({ url }) => {
    hooks.notify(`The page tried to open a new window to ${siteOf(url) || 'another page'}. I blocked it. Say "go to ${siteOf(url)}" if you want it.`);
    return { action: 'deny' };
  });
  // Pages can't stop the user leaving (AR-11).
  wc.on('will-prevent-unload', (e) => e.preventDefault());
  // will-navigate / will-frame-navigate fire only for PAGE-initiated
  // navigations (links, form posts, location=), never for loadURL calls the
  // user asked for. A public page may not navigate or POST into the local
  // network or to the user's model endpoints (review #6).
  const guard = (e: { preventDefault(): void }, url: string) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return e.preventDefault();
    }
    if (!ALLOWED_SCHEMES.has(target.protocol)) return e.preventDefault();
    let from: URL | null = null;
    try {
      from = new URL(wc.getURL());
    } catch {
      from = null;
    }
    const fromPublic = !from || !isPrivateHost(from.hostname);
    if ((fromPublic && isPrivateHost(target.hostname)) || hooks.protectedOrigins().includes(target.origin)) {
      e.preventDefault();
      hooks.notify('The page tried to send you to a device on your own network. I blocked it.');
    }
  };
  wc.on('will-navigate', (e) => guard(e, e.url));
  wc.on('will-frame-navigate', (e) => guard(e, e.url));
  wc.on('enter-html-full-screen', () => {
    hooks.notify('The page tried to go full screen. I kept the normal view.');
  });
  // No <webview>, no devtools for pages.
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('devtools-opened', () => wc.closeDevTools());
}

export function hardenApp(hooks: HardeningHooks): void {
  // Chromium's Private Network Access protections also catch DNS rebinding,
  // which hostname checks can't (review #6).
  app.commandLine.appendSwitch('enable-features', 'BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults');
  // Invalid certificates are never accepted silently (AR-4).
  app.on('certificate-error', (event, _wc, url, error, _cert, callback) => {
    event.preventDefault();
    callback(false);
    hooks.notify(`I did not open ${siteOf(url) || 'that page'} because its security certificate is not valid (${error}). It may be an imposter site.`);
  });
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}

function describePermission(p: string): string {
  const map: Record<string, string> = {
    media: 'your camera or microphone',
    geolocation: 'your location',
    notifications: 'send notifications',
    fullscreen: 'full screen',
    'clipboard-read': 'read your clipboard',
    midi: 'music devices',
    midiSysex: 'music devices',
    pointerLock: 'lock the mouse pointer',
    openExternal: 'open another app',
    'idle-detection': 'know when you are away',
    'window-management': 'manage your windows',
    'storage-access': 'store data across sites',
  };
  return map[p] ?? p;
}
