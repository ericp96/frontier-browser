import type { ActionResult, DigestOptions, ElementAction, PageDigest } from '../types.js';

/**
 * Everything the assistant needs from a browser. Product logic depends only
 * on this interface, never on Electron, Playwright or a Chromium fork (E1.2).
 */
export interface BrowserBackend {
  /** The committed URL as the browser knows it — the trusted source of origin. */
  currentUrl(): string;
  navigate(url: string): Promise<void>;
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  reload(): Promise<void>;
  digest(options?: DigestOptions): Promise<PageDigest>;
  act(action: ElementAction): Promise<ActionResult>;
  findText(query: string): Promise<{ ref: string; text: string }[]>;
  describe(ref: string): Promise<string>;
  /** Register for "a new document finished loading" (including SPA route changes when detectable). */
  onPageLoaded(listener: () => void): () => void;
  /** JavaScript dialogs (alert/confirm/prompt). Backends dismiss them; the assistant announces them. */
  onDialog?(listener: (d: { type: string; message: string }) => void): () => void;
}
