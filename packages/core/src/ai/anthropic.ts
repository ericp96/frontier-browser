import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatOptions, ChatResult, ModelProvider, ToolCall } from './provider.js';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/** Claude via the official Anthropic SDK. Runs only in a trusted process (AR-13). */
export class AnthropicProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;
  readonly isLocal = false;
  readonly supportsTools = true;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly cfg: AnthropicConfig,
    client?: Anthropic,
  ) {
    this.model = cfg.model ?? 'claude-opus-5-5';
    this.id = `anthropic:${this.model}`;
    this.label = `Claude (${this.model})`;
    this.client = client ?? new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: options.maxTokens ?? 16000,
        ...(system ? { system } : {}),
        messages: toAnthropic(messages),
        ...(options.tools?.length
          ? {
              tools: options.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
              tool_choice: { type: 'auto' as const },
            }
          : {}),
        ...(this.cfg.effort ? { output_config: { effort: this.cfg.effort } } : {}),
        // Re-run a safety-declined request on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      },
      { signal: options.signal },
    );

    if (response.stop_reason === 'refusal') {
      return { text: '', toolCalls: [], refused: true, raw: response.content };
    }
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id, name: block.name, arguments: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return { text, toolCalls, raw: response.content };
  }
}

function toAnthropic(messages: ChatMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.raw)) {
        // Echo the full content (including thinking blocks) unchanged.
        out.push({ role: 'assistant', content: m.raw as BetaContentBlockParam[] });
      } else {
        const content: BetaContentBlockParam[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        out.push({ role: 'assistant', content });
      }
    } else {
      // All tool results for one assistant turn go into ONE user message.
      const block: BetaContentBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        (last.content as BetaContentBlockParam[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}
