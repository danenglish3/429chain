import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GroqAdapter } from '../adapters/groq.js';
import { ProviderRateLimitError, ProviderError } from '../../shared/errors.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../shared/types.js';
import type { ProviderAdapter } from '../types.js';

// --- Test Helpers ---

function makeValidResponse(): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  };
}

function makeRequest(): ChatCompletionRequest {
  return { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] };
}

describe('BaseAdapter', () => {
  let adapter: ProviderAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new GroqAdapter('test-provider', 'Test Provider', 'test-api-key');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('chatCompletion', () => {
    it('returns ProviderResponse on 200', async () => {
      const validResponse = makeValidResponse();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      const result = await adapter.chatCompletion('test-model', makeRequest());

      expect(result.status).toBe(200);
      expect(result.body.object).toBe('chat.completion');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.headers).toBeInstanceOf(Headers);
    });

    it('throws ProviderRateLimitError on 429', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('rate limited', { status: 429 }))
      );

      await expect(adapter.chatCompletion('test-model', makeRequest())).rejects.toThrow(
        ProviderRateLimitError
      );

      try {
        await adapter.chatCompletion('test-model', makeRequest());
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderRateLimitError);
        if (error instanceof ProviderRateLimitError) {
          expect(error.statusCode).toBe(429);
          expect(error.providerId).toBe('test-provider');
          expect(error.headers).toBeInstanceOf(Headers);
        }
      }
    });

    it('throws ProviderError on non-OK non-429 (500)', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('Internal Server Error', { status: 500 }))
      );

      await expect(adapter.chatCompletion('test-model', makeRequest())).rejects.toThrow(
        ProviderError
      );

      try {
        await adapter.chatCompletion('test-model', makeRequest());
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        if (error instanceof ProviderError) {
          expect(error.statusCode).toBe(500);
        }
      }
    });

    it('throws ProviderError on 401', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      await expect(adapter.chatCompletion('test-model', makeRequest())).rejects.toThrow(
        ProviderError
      );

      try {
        await adapter.chatCompletion('test-model', makeRequest());
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        if (error instanceof ProviderError) {
          expect(error.statusCode).toBe(401);
        }
      }
    });

    it('sends correct headers (Authorization + Content-Type)', async () => {
      const validResponse = makeValidResponse();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      await adapter.chatCompletion('test-model', makeRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const headers = callArgs[1].headers;

      expect(headers['Authorization']).toBe('Bearer test-api-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends POST to {baseUrl}/chat/completions', async () => {
      const validResponse = makeValidResponse();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      await adapter.chatCompletion('test-model', makeRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    });
  });

  describe('chatCompletionStream', () => {
    it('returns Response on 200', async () => {
      fetchMock.mockResolvedValue(
        new Response('data: test', { status: 200 })
      );

      const result = await adapter.chatCompletionStream('test-model', makeRequest());

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(200);
    });

    it('throws ProviderRateLimitError on 429', async () => {
      fetchMock.mockResolvedValue(
        new Response('rate limited', { status: 429 })
      );

      await expect(adapter.chatCompletionStream('test-model', makeRequest())).rejects.toThrow(
        ProviderRateLimitError
      );
    });

    it('throws ProviderError on 500', async () => {
      fetchMock.mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      await expect(adapter.chatCompletionStream('test-model', makeRequest())).rejects.toThrow(
        ProviderError
      );
    });

    it('forces stream: true in request body', async () => {
      fetchMock.mockResolvedValue(
        new Response('data: test', { status: 200 })
      );

      await adapter.chatCompletionStream('test-model', makeRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.stream).toBe(true);
    });
  });

  describe('prepareRequestBody', () => {
    it('replaces model and sets stream: false', async () => {
      const validResponse = makeValidResponse();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      await adapter.chatCompletion('override-model', {
        model: 'original',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.model).toBe('override-model');
      expect(body.stream).toBe(false);
    });

    it('preserves additional request fields', async () => {
      const validResponse = makeValidResponse();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify(validResponse), { status: 200 })
      );

      await adapter.chatCompletion('test-model', {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.8,
        max_tokens: 100,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.temperature).toBe(0.8);
      expect(body.max_tokens).toBe(100);
    });
  });
});
