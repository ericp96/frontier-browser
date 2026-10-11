import type { ChatMessage, ChatOptions, ChatResult, ModelProvider, ToolCall } from './provider.js';
import { isLocalEndpoint } from '../privacy/privacy.js';

type FetchLike = typeof fetch;

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

/** Chat Completions client usable with any OpenAI-compatible server. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly isLocal: boolean;
  readonly supportsTools: boolean;
  private readonly baseUrl: string;

  constructor(
    private readonly cfg: { baseUrl: string; model: string; apiKey?: string; supportsTools?: boolean; label?: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.id = `openai-compatible:${cfg.model}`;
    this.label = cfg.label ?? `${cfg.model} at ${new URL(this.baseUrl).host}`;
    this.isLocal = isLocalEndpoint(this.baseUrl);
    this.supportsTools = cfg.supportsTools ?? true;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: messages.map(toOpenAI),
      max_tokens: options.maxTokens ?? 1024,
      stream: false,
    };
    if (options.tools?.length && this.supportsTools) {
      body.tools = options.tools.map((t) => ({ type: 'function', function: t }));
      body.tool_choice = 'auto';
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      throw new ProviderError(res.status, detail);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: OpenAIToolCall[] }; finish_reason?: string }[];
    };
    const choice = json.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments: parseArgs(tc.function?.arguments),
    }));
    return { text: msg?.content ?? '', toolCalls, refused: choice?.finish_reason === 'content_filter' };
  }
}

function parseArgs(a: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!a) return {};
  if (typeof a === 'object') return a;
  try {
    const v = JSON.parse(a) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toOpenAI(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    case 'assistant':
      return m.toolCalls?.length
        ? {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })),
          }
        : { role: 'assistant', content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(describeStatus(status) + (detail ? ` (${detail})` : ''));
  }
}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) return 'The AI service rejected the key. Check your AI settings.';
  if (status === 404) return 'The AI service could not find that model. Check the model name in settings.';
  if (status === 429) return 'The AI service says you have hit a limit. Wait a moment and try again.';
  if (status >= 500) return 'The AI service is having problems right now.';
  return `The AI service returned an error (${status}).`;
}
