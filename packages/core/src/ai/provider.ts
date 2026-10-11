/**
 * Bring-your-own-model provider abstraction.
 *
 * Two adapters cover nearly every option a user has:
 *  - OpenAI-compatible Chat Completions: Ollama, llama.cpp server, LM Studio,
 *    vLLM, LocalAI, Jan, OpenRouter, Groq, Together, Mistral, OpenAI, …
 *  - Anthropic (Claude) via the official SDK.
 *
 * Small local models often lack native tool calling, so the planner can run
 * in "json" mode where tools are described in the prompt instead.
 */

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /** Provider-native content (e.g. thinking blocks) that must be echoed back unchanged. */
      raw?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  /** The provider declined to answer (e.g. a safety refusal). */
  refused?: boolean;
  /** Provider-native assistant content to echo back on the next turn. */
  raw?: unknown;
}

export interface ChatOptions {
  tools?: ToolDef[];
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly label: string;
  /** True when requests never leave this machine/LAN — no consent prompt needed. */
  readonly isLocal: boolean;
  /** Whether the model reliably supports native tool calling. */
  readonly supportsTools: boolean;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

export type ProviderConfig =
  | {
      kind: 'openai-compatible';
      baseUrl: string;
      model: string;
      /** Never logged, never sent to renderers. */
      apiKey?: string;
      supportsTools?: boolean;
      label?: string;
    }
  | {
      kind: 'anthropic';
      model?: string;
      apiKey?: string;
      baseUrl?: string;
      effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    };

/** Presets for the setup wizard. Users can always edit every field. */
export const PROVIDER_PRESETS: Record<string, ProviderConfig & { note: string }> = {
  ollama: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', supportsTools: true, label: 'Ollama (on this computer)', note: 'Free and private. Runs on your computer; needs about 4 GB of free memory for small models.' },
  lmstudio: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', supportsTools: true, label: 'LM Studio (on this computer)', note: 'Free and private. Runs on your computer.' },
  llamacpp: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8080/v1', model: 'local', supportsTools: false, label: 'llama.cpp server (on this computer)', note: 'Free and private. Works on older computers with small models.' },
  openrouter: { kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', supportsTools: true, label: 'OpenRouter (cloud)', note: 'Cloud service with some free models. Check each model provider’s data and training policy.' },
  openai: { kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', supportsTools: true, label: 'OpenAI (cloud)', note: 'Paid cloud service. Pages you ask about are sent to OpenAI.' },
  anthropic: { kind: 'anthropic', model: 'claude-opus-5-5', label: 'Anthropic Claude (cloud)', note: 'Paid cloud service. Pages you ask about are sent to Anthropic.' } as ProviderConfig & { note: string },
};
