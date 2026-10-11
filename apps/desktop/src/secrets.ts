/**
 * API keys live only in the main process, encrypted with the OS keychain
 * (DPAPI / Keychain / libsecret). They are never sent to any renderer (AR-13).
 */
import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type SecretName = 'ai' | 'speechToText' | 'textToSpeech';

export class SecretStore {
  constructor(private readonly file: string) {}

  /** Why we can't store secrets on this machine, or null if we can. */
  unavailableReason(): string | null {
    if (!safeStorage.isEncryptionAvailable()) return 'This computer has no secure password storage available.';
    if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
      return 'No keyring is running (for example GNOME Keyring or KWallet), so I cannot store keys securely. Start a keyring, or use a local AI model that needs no key.';
    }
    return null;
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  /**
   * Store a key FOR ONE ORIGIN. A key is only ever released to the origin it
   * was entered for, so changing the endpoint (or importing a config that
   * points elsewhere) can't leak it (review #8).
   */
  set(name: SecretName, value: string | null, origin: string): void {
    const reason = this.unavailableReason();
    if (reason && value) throw new Error(reason);
    const all = this.read();
    if (value) all[name] = safeStorage.encryptString(JSON.stringify({ origin, key: value })).toString('base64');
    else delete all[name];
    writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 });
  }

  get(name: SecretName, origin: string): string | undefined {
    const v = this.read()[name];
    if (!v || this.unavailableReason()) return undefined;
    try {
      const stored = JSON.parse(safeStorage.decryptString(Buffer.from(v, 'base64'))) as { origin: string; key: string };
      return stored.origin === origin ? stored.key : undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether a key is stored for this origin. */
  hasFor(name: SecretName, origin: string): boolean {
    return this.get(name, origin) !== undefined;
  }

  has(name: SecretName): boolean {
    return !!this.read()[name];
  }
}
