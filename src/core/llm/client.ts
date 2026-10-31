import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  complete(messages: ChatMessage[]): Promise<LlmResult>;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Client for any OpenAI-compatible chat completions endpoint. */
export class OpenAiCompatClient implements LlmClient {
  private readonly client: OpenAI;
  private jsonMode = true;

  constructor(private readonly config: LlmConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      dangerouslyAllowBrowser: true, // BYOK: the key never leaves the user's browser profile
    });
  }

  async complete(messages: ChatMessage[]): Promise<LlmResult> {
    try {
      return await this.request(messages);
    } catch (err) {
      // Some compatible endpoints reject response_format; retry once without it.
      if (this.jsonMode && err instanceof OpenAI.BadRequestError) {
        this.jsonMode = false;
        return this.request(messages);
      }
      throw err;
    }
  }

  private async request(messages: ChatMessage[]): Promise<LlmResult> {
    const res = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: 0.2,
      ...(this.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
    });
    return {
      content: res.choices[0]?.message?.content ?? '',
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    };
  }
}

/** Short, user-facing description of an LLM failure (never includes keys or request content). */
export function describeLlmError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401 || err.status === 403) return 'LLM API key rejected (check Settings).';
    if (err.status === 402) return 'LLM account has no balance.';
    if (err.status === 429) return 'LLM rate limit reached; retrying shortly.';
    if (err.status && err.status >= 500)
      return `LLM provider error (${err.status}); retrying shortly.`;
    return `LLM request failed (${err.status ?? 'network'}).`;
  }
  return err instanceof Error ? err.message : 'LLM request failed.';
}
