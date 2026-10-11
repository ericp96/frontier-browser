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

  set(name: SecretName, value: string | null): void {
    const reason = this.unavailableReason();
    if (reason && value) throw new Error(reason);
    const all = this.read();
    if (value) all[name] = safeStorage.encryptString(value).toString('base64');
    else delete all[name];
    writeFileSync(this.file, JSON.stringify(all), { mode: 0o600 });
  }

  get(name: SecretName): string | undefined {
    const v = this.read()[name];
    if (!v || this.unavailableReason()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(v, 'base64'));
    } catch {
      return undefined;
    }
  }

  has(name: SecretName): boolean {
    return !!this.read()[name];
  }
}
