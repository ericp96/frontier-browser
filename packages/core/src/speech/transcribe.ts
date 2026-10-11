/**
 * Speech-to-text via any OpenAI-compatible `/audio/transcriptions` endpoint:
 * whisper.cpp server, faster-whisper-server, LocalAI, Speaches, or a cloud
 * provider. Web Speech recognition is NOT used: in Electron/Chromium forks it
 * depends on Google's servers and keys (AR-14).
 */
import { isLocalEndpoint } from '../privacy/privacy.js';

export interface TranscriptionConfig {
  baseUrl: string;
  model?: string;
  apiKey?: string;
  language?: string;
}

export class TranscriptionClient {
  readonly isLocal: boolean;
  constructor(
    private readonly cfg: TranscriptionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.isLocal = isLocalEndpoint(cfg.baseUrl);
  }

  async transcribe(audio: Blob, filename = 'speech.webm', signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append('file', audio, filename);
    form.append('model', this.cfg.model ?? 'whisper-1');
    form.append('response_format', 'json');
    if (this.cfg.language) form.append('language', this.cfg.language);
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers,
      body: form,
      signal,
    });
    if (!res.ok) throw new Error(`Speech recognition failed (${res.status}). Check your speech settings, or type your command instead.`);
    const json = (await res.json()) as { text?: string };
    return (json.text ?? '').trim();
  }
}

/** BYO text-to-speech via OpenAI-compatible `/audio/speech` (Piper, Kokoro, OpenAI…). */
export async function synthesizeSpeech(
  cfg: { baseUrl: string; model?: string; voice?: string; apiKey?: string },
  text: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetchImpl(`${cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: cfg.model ?? 'tts-1', voice: cfg.voice ?? 'alloy', input: text, response_format: 'mp3' }),
    signal,
  });
  if (!res.ok) throw new Error(`Speech synthesis failed (${res.status}).`);
  return res.arrayBuffer();
}
