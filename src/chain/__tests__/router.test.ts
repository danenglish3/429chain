import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeChain, executeStreamChain, resolveChain } from '../router.js';
import { RateLimitTracker } from '../../ratelimit/tracker.js';
import {
  AllProvidersExhaustedError,
  ProviderRateLimitError,
  ProviderError,
} from '../../shared/errors.js';
import type { Chain, ChainResult } from '../types.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../shared/types.js';
import type { ProviderAdapter, ProviderRegistry, ProviderResponse, RateLimitInfo } from '../../providers/types.js';

// --- Test helpers ---

/** Create a minimal chat completion request for testing. */
function makeRequest(): ChatCompletionRequest {
  return {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hello' }],
  };
}

/** Create a minimal chat completion response for testing. */
function makeResponse(model: string): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

/** Create a mock ProviderAdapter that succeeds. */
function createSuccessAdapter(
  id: string,
  rateLimitInfo: RateLimitInfo | null = null,
): ProviderAdapter {
  return {
    id,
    providerType: 'test',
    name: `Test ${id}`,
    baseUrl: `https://${id}.example.com`,
    chatCompletion: vi.fn(async (model: string) => {
      return {
        status: 200,
        body: makeResponse(model),
        headers: new Headers(),
        latencyMs: 50,
      } satisfies ProviderResponse;
    }),
    chatCompletionStream: vi.fn(async () => {
      return new Response('mock stream', { status: 200 });
    }),
    parseRateLimitHeaders: vi.fn(() => rateLimitInfo),
    getExtraHeaders: () => ({}),
  };
}

/** Create a mock ProviderAdapter that throws a 429. */
function createRateLimitAdapter(
  id: string,
  retryAfterSeconds?: number,
): ProviderAdapter {
  return {
    id,
    providerType: 'test',
    name: `Test ${id}`,
    baseUrl: `https://${id}.example.com`,
    chatCompletion: vi.fn(async () => {
      const headers = new Headers();
      if (retryAfterSeconds !== undefined) {
        headers.set('retry-after', String(retryAfterSeconds));
      }
      throw new ProviderRateLimitError(id, 'test-model', headers);
    }),
    chatCompletionStream: vi.fn(async () => {
      const headers = new Headers();
      if (retryAfterSeconds !== undefined) {
        headers.set('retry-after', String(retryAfterSeconds));
      }
      throw new ProviderRateLimitError(id, 'test-model', headers);
    }),
    parseRateLimitHeaders: vi.fn(() => null),
    getExtraHeaders: () => ({}),
  };
}

/** Create a mock ProviderAdapter that throws a 500. */
function createServerErrorAdapter(id: string): ProviderAdapter {
  return {
    id,
    providerType: 'test',
    name: `Test ${id}`,
    baseUrl: `https://${id}.example.com`,
    chatCompletion: vi.fn(async () => {
      throw new ProviderError(id, 'test-model', 500, 'Internal Server Error');
    }),
    chatCompletionStream: vi.fn(async () => {
      throw new ProviderError(id, 'test-model', 500, 'Internal Server Error');
    }),
    parseRateLimitHeaders: vi.fn(() => null),
    getExtraHeaders: () => ({}),
  };
}

/** Create a mock ProviderAdapter that throws a network error. */
function createNetworkErrorAdapter(id: string): ProviderAdapter {
  return {
    id,
    providerType: 'test',
    name: `Test ${id}`,
    baseUrl: `https://${id}.example.com`,
    chatCompletion: vi.fn(async () => {
      throw new Error('ECONNREFUSED: connection refused');
    }),
    chatCompletionStream: vi.fn(async () => {
      throw new Error('ECONNREFUSED: connection refused');
    }),
    parseRateLimitHeaders: vi.fn(() => null),
    getExtraHeaders: () => ({}),
  };
}

/** Build a simple registry from a list of adapters. */
function createRegistry(adapters: ProviderAdapter[]): ProviderRegistry {
  const map = new Map(adapters.map((a) => [a.id, a]));
  return {
    get(providerId: string): ProviderAdapter {
      const adapter = map.get(providerId);
      if (!adapter) throw new Error(`Unknown provider: ${providerId}`);
      return adapter;
    },
    has(providerId: string): boolean {
      return map.has(providerId);
    },
    getAll(): ProviderAdapter[] {
      return [...map.values()];
    },
    get size(): number {
      return map.size;
    },
    add(id: string, adapter: ProviderAdapter): void {
      map.set(id, adapter);
    },
    remove(id: string): boolean {
      return map.delete(id);
    },
  };
}

// --- Tests ---

describe('executeChain', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should return first provider response when it succeeds', async () => {
    const adapter1 = createSuccessAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(result.model).toBe('model-1');
    expect(result.response.object).toBe('chat.completion');
    expect(result.attempts).toHaveLength(0); // no failed attempts before success
    expect(adapter1.chatCompletion).toHaveBeenCalledTimes(1);
    expect(adapter2.chatCompletion).not.toHaveBeenCalled();
  });

  it('should waterfall to second provider on 429', async () => {
    const adapter1 = createRateLimitAdapter('provider-a', 30);
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(result.model).toBe('model-2');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.error).toBe('429_rate_limited');
    expect(result.attempts[0]!.retryAfter).toBe(30_000); // 30 seconds in ms
    expect(adapter1.chatCompletion).toHaveBeenCalledTimes(1);
    expect(adapter2.chatCompletion).toHaveBeenCalledTimes(1);

    // Provider-a should now be marked exhausted
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
  });

  it('should waterfall to second provider on 500', async () => {
    const adapter1 = createServerErrorAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.error).toContain('500');
  });

  it('should waterfall on network errors (connection refused)', async () => {
    const adapter1 = createNetworkErrorAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.error).toContain('ECONNREFUSED');
  });

  it('should throw AllProvidersExhaustedError when all fail', async () => {
    const adapter1 = createRateLimitAdapter('provider-a');
    const adapter2 = createServerErrorAdapter('provider-b');
    const adapter3 = createNetworkErrorAdapter('provider-c');
    const registry = createRegistry([adapter1, adapter2, adapter3]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
        { providerId: 'provider-c', model: 'model-3' },
      ],
    };

    await expect(
      executeChain(chain, makeRequest(), tracker, registry),
    ).rejects.toThrow(AllProvidersExhaustedError);

    try {
      await executeChain(chain, makeRequest(), tracker, registry);
    } catch (error) {
      const exhaustedError = error as AllProvidersExhaustedError;
      // All three providers should be in the attempts
      // Note: provider-a is now on cooldown from the first call, so second call skips it
      expect(exhaustedError.attempts.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should have correct attempt records when all fail', async () => {
    const adapter1 = createRateLimitAdapter('provider-a');
    const adapter2 = createServerErrorAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    try {
      await executeChain(chain, makeRequest(), tracker, registry);
      expect.fail('Should have thrown');
    } catch (error) {
      const exhaustedError = error as AllProvidersExhaustedError;
      expect(exhaustedError.attempts).toHaveLength(2);

      expect(exhaustedError.attempts[0]!.provider).toBe('provider-a');
      expect(exhaustedError.attempts[0]!.error).toBe('429_rate_limited');

      expect(exhaustedError.attempts[1]!.provider).toBe('provider-b');
      expect(exhaustedError.attempts[1]!.error).toContain('500');
    }
  });

  it('should skip exhausted providers without calling chatCompletion', async () => {
    const adapter1 = createSuccessAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    // Pre-mark provider-a as exhausted
    tracker.markExhausted('provider-a', 'model-1', 60_000, 'test exhaustion');

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.provider).toBe('provider-a');
    expect(result.attempts[0]!.skipped).toBe(true);
    expect(result.attempts[0]!.error).toBe('on_cooldown');

    // provider-a's chatCompletion should NOT have been called
    expect(adapter1.chatCompletion).not.toHaveBeenCalled();
    expect(adapter2.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('should proactively mark exhausted when remaining requests = 0', async () => {
    const adapter1 = createSuccessAdapter('provider-a', {
      remainingRequests: 0,
      resetRequestsMs: 5000,
    });
    const registry = createRegistry([adapter1]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    // After success, the provider should be proactively marked exhausted
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
    expect(tracker.getStatus('provider-a', 'model-1').reason).toBe(
      'proactive: remaining requests = 0',
    );
  });

  it('should handle 429 without retry-after header', async () => {
    // No retryAfterSeconds argument = no retry-after header
    const adapter1 = createRateLimitAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(result.attempts[0]!.retryAfter).toBeUndefined();
    // Provider-a should still be exhausted with default cooldown
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
  });

  it('should parse float retry-after values without truncation', async () => {
    // Groq sends retry-after: 8.12
    const adapter1 = createRateLimitAdapter('provider-a', 8.12);
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    // 8.12 seconds = 8120ms, not 8000ms (which parseInt would give)
    expect(result.attempts[0]!.retryAfter).toBeCloseTo(8120, 0);
  });

  it('should handle a single-entry chain that succeeds', async () => {
    const adapter1 = createSuccessAdapter('provider-a');
    const registry = createRegistry([adapter1]);

    const chain: Chain = {
      name: 'single',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(result.attempts).toHaveLength(0);
  });

  it('should throw on single-entry chain that fails', async () => {
    const adapter1 = createRateLimitAdapter('provider-a');
    const registry = createRegistry([adapter1]);

    const chain: Chain = {
      name: 'single',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    await expect(
      executeChain(chain, makeRequest(), tracker, registry),
    ).rejects.toThrow(AllProvidersExhaustedError);
  });

  it('should handle all entries being exhausted (skipped)', async () => {
    const adapter1 = createSuccessAdapter('provider-a');
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter1, adapter2]);

    // Pre-mark both as exhausted
    tracker.markExhausted('provider-a', 'model-1', 60_000);
    tracker.markExhausted('provider-b', 'model-2', 60_000);

    const chain: Chain = {
      name: 'all-exhausted',
      entries: [
        { providerId: 'provider-a', model: 'model-1' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    try {
      await executeChain(chain, makeRequest(), tracker, registry);
      expect.fail('Should have thrown');
    } catch (error) {
      const exhaustedError = error as AllProvidersExhaustedError;
      expect(exhaustedError.attempts).toHaveLength(2);
      expect(exhaustedError.attempts.every((a) => a.skipped === true)).toBe(true);
      expect(adapter1.chatCompletion).not.toHaveBeenCalled();
      expect(adapter2.chatCompletion).not.toHaveBeenCalled();
    }
  });
});

describe('Proactive quota tracking (non-streaming)', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should call tracker.updateQuota on successful response with headers', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 10,
      resetRequestsMs: 5000,
      remainingTokens: 1000,
      resetTokensMs: 5000,
    };
    const adapter = createSuccessAdapter('provider-a', rateLimitInfo);
    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    // Spy on updateQuota
    const updateQuotaSpy = vi.spyOn(tracker, 'updateQuota');

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(updateQuotaSpy).toHaveBeenCalledWith('provider-a', 'model-1', rateLimitInfo);
    expect(adapter.parseRateLimitHeaders).toHaveBeenCalledTimes(1);
  });

  it('should mark provider exhausted when remainingTokens === 0', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 10,
      resetRequestsMs: 5000,
      remainingTokens: 0,
      resetTokensMs: 8000,
    };
    const adapter = createSuccessAdapter('provider-a', rateLimitInfo);
    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    // First request succeeds but marks exhausted
    const result = await executeChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');

    // Provider should now be exhausted on next call
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
    const status = tracker.getStatus('provider-a', 'model-1');
    expect(status.status).toBe('exhausted');
    expect(status.reason).toBe('proactive: remaining tokens = 0');
  });

  it('should keep provider in tracking state when remaining > 0', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 50,
      resetRequestsMs: 10000,
      remainingTokens: 5000,
      resetTokensMs: 10000,
    };
    const adapter = createSuccessAdapter('provider-a', rateLimitInfo);
    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');

    // Provider should NOT be exhausted
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(false);
    const status = tracker.getStatus('provider-a', 'model-1');
    expect(status.status).toBe('tracking');
    expect(status.quota?.remainingRequests).toBe(50);
    expect(status.quota?.remainingTokens).toBe(5000);
  });

  it('should not call updateQuota when no rate limit headers', async () => {
    const adapter = createSuccessAdapter('provider-a', null);
    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const updateQuotaSpy = vi.spyOn(tracker, 'updateQuota');

    const result = await executeChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');
    expect(updateQuotaSpy).not.toHaveBeenCalled();
    expect(adapter.parseRateLimitHeaders).toHaveBeenCalledTimes(1);
  });

  it('should mark exhausted when both requests and tokens are zero', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 0,
      resetRequestsMs: 5000,
      remainingTokens: 0,
      resetTokensMs: 8000,
    };
    const adapter = createSuccessAdapter('provider-a', rateLimitInfo);
    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');

    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
    const status = tracker.getStatus('provider-a', 'model-1');
    expect(status.status).toBe('exhausted');
    expect(status.reason).toBe('proactive: remaining requests and tokens = 0');
  });
});

describe('Proactive quota tracking (streaming)', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should call tracker.updateQuota on streaming response with rate limit headers', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 15,
      resetRequestsMs: 6000,
      remainingTokens: 2000,
      resetTokensMs: 6000,
    };

    // Create adapter with custom stream response that has rate limit headers
    const adapter: ProviderAdapter = {
      id: 'provider-a',
      providerType: 'test',
      name: 'Test provider-a',
      baseUrl: 'https://provider-a.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        return new Response('data: {"choices":[{"delta":{"content":"test"}}]}', {
          status: 200,
          headers: {
            'x-ratelimit-remaining-requests': '15',
            'x-ratelimit-reset-requests': '6s',
            'x-ratelimit-remaining-tokens': '2000',
            'x-ratelimit-reset-tokens': '6s',
          },
        });
      }),
      parseRateLimitHeaders: vi.fn(() => rateLimitInfo),
      getExtraHeaders: () => ({}),
    };

    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const updateQuotaSpy = vi.spyOn(tracker, 'updateQuota');

    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(updateQuotaSpy).toHaveBeenCalledWith('provider-a', 'model-1', rateLimitInfo);
    expect(adapter.parseRateLimitHeaders).toHaveBeenCalledTimes(1);
  });

  it('should mark provider exhausted when streaming response has remainingRequests === 0', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 0,
      resetRequestsMs: 10000,
      remainingTokens: 5000,
      resetTokensMs: 10000,
    };

    const adapter: ProviderAdapter = {
      id: 'provider-a',
      providerType: 'test',
      name: 'Test provider-a',
      baseUrl: 'https://provider-a.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        return new Response('data: {"choices":[{"delta":{"content":"test"}}]}', {
          status: 200,
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '10s',
          },
        });
      }),
      parseRateLimitHeaders: vi.fn(() => rateLimitInfo),
      getExtraHeaders: () => ({}),
    };

    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    // First stream succeeds but marks exhausted
    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');

    // Provider should now be exhausted
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
    const status = tracker.getStatus('provider-a', 'model-1');
    expect(status.status).toBe('exhausted');
    expect(status.reason).toBe('proactive: remaining requests = 0');
  });

  it('should not call updateQuota when streaming response has no rate limit headers', async () => {
    const adapter: ProviderAdapter = {
      id: 'provider-a',
      providerType: 'test',
      name: 'Test provider-a',
      baseUrl: 'https://provider-a.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        return new Response('data: {"choices":[{"delta":{"content":"test"}}]}', {
          status: 200,
          headers: {}, // No rate limit headers
        });
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };

    const registry = createRegistry([adapter]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const updateQuotaSpy = vi.spyOn(tracker, 'updateQuota');

    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);
    expect(result.providerId).toBe('provider-a');
    expect(updateQuotaSpy).not.toHaveBeenCalled();
    expect(adapter.parseRateLimitHeaders).toHaveBeenCalledTimes(1);
  });
});

describe('resolveChain', () => {
  const chains = new Map<string, Chain>();
  chains.set('fast', {
    name: 'fast',
    entries: [{ providerId: 'groq', model: 'llama-3.1-8b' }],
  });
  chains.set('fallback', {
    name: 'fallback',
    entries: [
      { providerId: 'groq', model: 'llama-3.1-8b' },
      { providerId: 'openrouter', model: 'llama-3.1-8b' },
    ],
  });

  it('should resolve a named chain', () => {
    const chain = resolveChain('fast', chains, 'fallback');
    expect(chain.name).toBe('fast');
  });

  it('should use default chain when no name provided', () => {
    const chain = resolveChain(undefined, chains, 'fallback');
    expect(chain.name).toBe('fallback');
  });

  it('should throw when chain name not found', () => {
    expect(() => resolveChain('nonexistent', chains, 'fallback')).toThrow(
      'Chain "nonexistent" not found',
    );
  });

  it('should throw when default chain not found', () => {
    expect(() => resolveChain(undefined, chains, 'missing-default')).toThrow(
      'Chain "missing-default" not found',
    );
  });
});

describe('402 Payment Required handling', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should apply cooldown on 402 and waterfall to next provider', async () => {
    // Create adapter that returns 402 (credit exhaustion)
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      chatCompletionStream: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    // Should waterfall to provider-b
    expect(result.providerId).toBe('provider-b');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.error).toContain('402');

    // openrouter should now be on cooldown
    expect(tracker.isExhausted('openrouter', 'test-model')).toBe(true);
    const status = tracker.getStatus('openrouter', 'test-model');
    expect(status.reason).toBe('402 payment required (credits exhausted)');
  });

  it('should apply cooldown on 402 in streaming path', async () => {
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(tracker.isExhausted('openrouter', 'test-model')).toBe(true);
    const status = tracker.getStatus('openrouter', 'test-model');
    expect(status.reason).toBe('402 payment required (credits exhausted)');
  });

  it('should skip 402-cooled provider on subsequent requests', async () => {
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required');
      }),
      chatCompletionStream: vi.fn(),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    // First request: 402 triggers cooldown, waterfalls to provider-b
    await executeChain(chain, makeRequest(), tracker, registry);

    // Second request: openrouter should be skipped entirely (on cooldown)
    const result2 = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result2.providerId).toBe('provider-b');
    expect(result2.attempts).toHaveLength(1);
    expect(result2.attempts[0]!.skipped).toBe(true);
    expect(result2.attempts[0]!.error).toBe('on_cooldown');

    // chatCompletion should only have been called once (first request)
    expect(adapter402.chatCompletion).toHaveBeenCalledTimes(1);
  });
});

describe('Manual rate limit fallback', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should call recordRequest when no headers but manual limits exist', async () => {
    // Create adapter with no rate limit headers
    const adapter = createSuccessAdapter('provider-a', null);
    const registry = createRegistry([adapter]);

    // Register manual limits
    tracker.registerManualLimits('provider-a', 'model-1', {
      requestsPerMinute: 30,
    });

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    // Spy on recordRequest
    const recordRequestSpy = vi.spyOn(tracker, 'recordRequest');

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(recordRequestSpy).toHaveBeenCalledWith('provider-a', 'model-1');
    expect(recordRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('should NOT call recordRequest when no headers and NO manual limits', async () => {
    const adapter = createSuccessAdapter('provider-a', null);
    const registry = createRegistry([adapter]);

    // Do NOT register manual limits

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const recordRequestSpy = vi.spyOn(tracker, 'recordRequest');

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(recordRequestSpy).not.toHaveBeenCalled();
  });

  it('should NOT call recordRequest when headers present (header path takes precedence)', async () => {
    const rateLimitInfo: RateLimitInfo = {
      remainingRequests: 50,
      resetRequestsMs: 10000,
    };
    const adapter = createSuccessAdapter('provider-a', rateLimitInfo);
    const registry = createRegistry([adapter]);

    // Register manual limits (but headers should take precedence)
    tracker.registerManualLimits('provider-a', 'model-1', {
      requestsPerMinute: 30,
    });

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const recordRequestSpy = vi.spyOn(tracker, 'recordRequest');
    const updateQuotaSpy = vi.spyOn(tracker, 'updateQuota');

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(updateQuotaSpy).toHaveBeenCalledWith('provider-a', 'model-1', rateLimitInfo);
    expect(recordRequestSpy).not.toHaveBeenCalled();
  });

  it('should call recordRequest in streaming path when no headers but manual limits exist', async () => {
    // Create streaming adapter with no rate limit headers
    const adapter: ProviderAdapter = {
      id: 'provider-a',
      providerType: 'test',
      name: 'Test provider-a',
      baseUrl: 'https://provider-a.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        return new Response('data: {"choices":[{"delta":{"content":"test"}}]}', {
          status: 200,
          headers: {}, // No rate limit headers
        });
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };

    const registry = createRegistry([adapter]);

    // Register manual limits
    tracker.registerManualLimits('provider-a', 'model-1', {
      requestsPerMinute: 30,
    });

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    const recordRequestSpy = vi.spyOn(tracker, 'recordRequest');

    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-a');
    expect(recordRequestSpy).toHaveBeenCalledWith('provider-a', 'model-1');
    expect(recordRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('should exhaust provider after enough requests to exceed manual RPM limit', async () => {
    const adapter = createSuccessAdapter('provider-a', null);
    const registry = createRegistry([adapter]);

    // Register manual limits with low RPM
    tracker.registerManualLimits('provider-a', 'model-1', {
      requestsPerMinute: 3,
    });

    const chain: Chain = {
      name: 'test-chain',
      entries: [{ providerId: 'provider-a', model: 'model-1' }],
    };

    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const result = await executeChain(chain, makeRequest(), tracker, registry);
      expect(result.providerId).toBe('provider-a');
    }

    // Provider should now be exhausted
    expect(tracker.isExhausted('provider-a', 'model-1')).toBe(true);
    const status = tracker.getStatus('provider-a', 'model-1');
    expect(status.reason).toBe('manual limit: RPM exceeded');

    // Next request should throw AllProvidersExhaustedError
    await expect(
      executeChain(chain, makeRequest(), tracker, registry),
    ).rejects.toThrow(AllProvidersExhaustedError);
  });
});
