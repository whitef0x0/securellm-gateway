import Anthropic from '@anthropic-ai/sdk';
import { getConfig } from '../config';

interface ProviderChatInput {
  model: string;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  allowedModels?: string[];
}

interface ProviderChatOutput {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class ProviderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function chat(input: ProviderChatInput): Promise<ProviderChatOutput> {
  const { ANTHROPIC_API_KEY } = getConfig();

  if (!ANTHROPIC_API_KEY) {
    throw new ProviderError(503, 'provider_unavailable', 'Anthropic API key not configured');
  }

  if (input.allowedModels?.length && !input.allowedModels.includes(input.model)) {
    throw new ProviderError(403, 'model_not_allowed', `Model ${input.model} not in allowlist`);
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  try {
    const response = await client.messages.create({
      model: input.model,
      max_tokens: 4096,
      system: input.system,
      messages: input.messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      content: text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string };
    if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
      throw new ProviderError(504, 'provider_timeout', 'Provider request timed out');
    }
    if (e.status === 429) {
      throw new ProviderError(503, 'provider_unavailable', 'Provider rate limited');
    }
    if (typeof e.status === 'number' && e.status >= 500) {
      throw new ProviderError(502, 'provider_error', `Provider returned ${e.status}`);
    }
    throw new ProviderError(502, 'provider_error', 'Unexpected provider error');
  }
}
