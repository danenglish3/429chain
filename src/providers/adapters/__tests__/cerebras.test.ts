import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CerebrasAdapter } from '../cerebras.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../../shared/types.js';

describe('CerebrasAdapter', () => {
  let adapter: CerebrasAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new CerebrasAdapter('test-provider', 'Test Provider', 'test-api-key');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('prepareRequestBody', () => {
    it('strips presence_penalty and frequency_penalty from request', async () => {
      const validResponse: ChatCompletionResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'llama-70b',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      const requestBody: ChatCompletionRequest = {
        model: 'ignored',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.7,
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
      };

      await adapter.chatCompletion('llama-70b', requestBody);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(callArgs[1].body);

      expect(sentBody.model).toBe('llama-70b');
      expect(sentBody.temperature).toBe(0.7);
      expect(sentBody.stream).toBe(false);
      expect(sentBody).not.toHaveProperty('presence_penalty');
      expect(sentBody).not.toHaveProperty('frequency_penalty');
    });

    it('preserves other parameters', async () => {
      const validResponse: ChatCompletionResponse = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'llama-70b',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      };

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      const requestBody: ChatCompletionRequest = {
        model: 'ignored',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.8,
        max_tokens: 100,
        top_p: 0.9,
      };

      await adapter.chatCompletion('llama-70b', requestBody);

      const callArgs = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(callArgs[1].body);

      expect(sentBody.temperature).toBe(0.8);
      expect(sentBody.max_tokens).toBe(100);
      expect(sentBody.top_p).toBe(0.9);
      expect(sentBody.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    });
  });

  describe('parseRateLimitHeaders', () => {
    it('parses all 6 day/minute headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests-day': '1000',
        'x-ratelimit-remaining-requests-day': '950',
        'x-ratelimit-reset-requests-day': '3600',
        'x-ratelimit-limit-tokens-minute': '60000',
        'x-ratelimit-remaining-tokens-minute': '55000',
        'x-ratelimit-reset-tokens-minute': '45',
      });

      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 1000,
        remainingRequests: 950,
        resetRequestsMs: 3600000,
        limitTokens: 60000,
        remainingTokens: 55000,
        resetTokensMs: 45000,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });
  });

  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new CerebrasAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://api.cerebras.ai/v1');
    });

    it('uses provided base URL when given', () => {
      const adapter = new CerebrasAdapter('test', 'Test', 'key', 'https://custom.cerebras.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.cerebras.com/v1');
    });
  });
});
