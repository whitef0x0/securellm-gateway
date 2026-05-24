import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chat, ProviderError } from '../../src/services/llmProvider';

vi.mock('../../src/config');

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

const { getConfig } = await import('../../src/config');

function withKey() {
  vi.mocked(getConfig).mockReturnValue({ ANTHROPIC_API_KEY: 'sk-ant-test' } as any);
}

const baseInput = {
  model: 'claude-haiku-4-5-20251001',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

describe('llmProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('throws ProviderError 503 when ANTHROPIC_API_KEY is absent', async () => {
    vi.mocked(getConfig).mockReturnValue({ ANTHROPIC_API_KEY: undefined } as any);
    const err = await chat(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('provider_unavailable');
  });

  it('throws ProviderError 403 when model not in allowedModels', async () => {
    withKey();
    const err = await chat({ ...baseInput, allowedModels: ['claude-opus-4-7'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('model_not_allowed');
  });

  it('returns content, model, and token counts on success', async () => {
    withKey();
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hi there' }],
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const out = await chat(baseInput);
    expect(out).toMatchObject({
      content: 'hi there',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 5,
      outputTokens: 3,
    });
  });

  it('maps Anthropic 429 to ProviderError 503', async () => {
    withKey();
    mockCreate.mockRejectedValue(Object.assign(new Error('rate limited'), { status: 429 }));
    const err = await chat(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(503);
    expect(err.code).toBe('provider_unavailable');
  });

  it('maps Anthropic 5xx to ProviderError 502', async () => {
    withKey();
    mockCreate.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));
    const err = await chat(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('provider_error');
  });

  it('maps request timeout to ProviderError 504', async () => {
    withKey();
    mockCreate.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const err = await chat(baseInput).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(504);
    expect(err.code).toBe('provider_timeout');
  });
});
