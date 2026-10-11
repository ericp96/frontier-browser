/**
 * Configuration file format. A trusted helper (family member, volunteer,
 * IT support) can prepare this file so a newly blind user never has to
 * configure a model endpoint by voice (AR-10).
 *
 * Secrets in an imported file are moved into the OS keychain by the shell and
 * removed from the file on disk.
 */
import { AnthropicProvider } from './ai/anthropic.js';
import { OpenAICompatibleProvider } from './ai/openai-compatible.js';
import type { ModelProvider, ProviderConfig } from './ai/provider.js';
import { DEFAULT_SETTINGS, type Settings } from './assistant/assistant.js';
import type { TranscriptionConfig } from './speech/transcribe.js';

export interface FrontierConfig {
  version: 1;
  settings?: Partial<Settings>;
  ai?: ProviderConfig | null;
  speechToText?: TranscriptionConfig | null;
  textToSpeech?: { baseUrl: string; model?: string; voice?: string; apiKey?: string } | null;
}

export function createProvider(cfg: ProviderConfig | null | undefined): ModelProvider | null {
  if (!cfg) return null;
  if (cfg.kind === 'anthropic') return new AnthropicProvider(cfg);
  return new OpenAICompatibleProvider(cfg);
}

const PROFILES = new Set(['voice', 'screen-reader', 'braille']);
const VERBOSITY = new Set(['terse', 'normal', 'guided']);

/** Validate untrusted JSON (a file someone handed the user) into a config. */
export function parseConfig(json: string): FrontierConfig {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('Unsupported configuration version.');
  const out: FrontierConfig = { version: 1 };
  const s = (raw.settings ?? {}) as Record<string, unknown>;
  const settings: Partial<Settings> = {};
  if (typeof s.profile === 'string' && PROFILES.has(s.profile)) settings.profile = s.profile as Settings['profile'];
  if (typeof s.verbosity === 'string' && VERBOSITY.has(s.verbosity)) settings.verbosity = s.verbosity as Settings['verbosity'];
  if (s.autoRead === 'content' || s.autoRead === 'summary' || s.autoRead === 'outline') settings.autoRead = s.autoRead;
  if (typeof s.homeUrl === 'string' && /^(https:|about:|frontier:)/.test(s.homeUrl)) settings.homeUrl = s.homeUrl;
  if (typeof s.searchUrl === 'string' && /^https:\/\/.+%s/.test(s.searchUrl)) settings.searchUrl = s.searchUrl;
  out.settings = settings;

  const ai = raw.ai as Record<string, unknown> | null | undefined;
  if (ai && typeof ai === 'object') {
    if (ai.kind === 'anthropic') {
      out.ai = { kind: 'anthropic', model: str(ai.model), apiKey: str(ai.apiKey), effort: ['low', 'medium', 'high', 'xhigh', 'max'].includes(String(ai.effort)) ? (ai.effort as 'low') : undefined };
    } else if (ai.kind === 'openai-compatible' && typeof ai.baseUrl === 'string' && typeof ai.model === 'string') {
      const u = new URL(ai.baseUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('AI address must be http or https.');
      out.ai = { kind: 'openai-compatible', baseUrl: ai.baseUrl, model: ai.model, apiKey: str(ai.apiKey), supportsTools: ai.supportsTools !== false, label: str(ai.label) };
    }
  }
  const stt = raw.speechToText as Record<string, unknown> | null | undefined;
  if (stt && typeof stt.baseUrl === 'string') out.speechToText = { baseUrl: stt.baseUrl, model: str(stt.model), apiKey: str(stt.apiKey), language: str(stt.language) };
  const tts = raw.textToSpeech as Record<string, unknown> | null | undefined;
  if (tts && typeof tts.baseUrl === 'string') out.textToSpeech = { baseUrl: tts.baseUrl, model: str(tts.model), voice: str(tts.voice), apiKey: str(tts.apiKey) };
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function defaultConfig(): FrontierConfig {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, ai: null, speechToText: null, textToSpeech: null };
}
