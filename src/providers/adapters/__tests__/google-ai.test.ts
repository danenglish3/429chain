import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleAIAdapter } from '../google-ai.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../../shared/types.js';

const makeResponse = (): ChatCompletionResponse => ({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: 'gemma-3-27b-it',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
});

describe('GoogleAIAdapter', () => {
  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    });

    it('uses provided base URL when given', () => {
      const adapter = new GoogleAIAdapter('test', 'Test', 'key', 'https://custom.example.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.example.com/v1');
    });

    it('sets provider type to google-ai', () => {
      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      expect(adapter.providerType).toBe('google-ai');
    });
  });

  describe('parseRateLimitHeaders', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('parses Retry-After header with seconds', () => {
      const headers = new Headers({
        'Retry-After': '60',
      });

      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        resetRequestsMs: 60000,
      });
    });

    it('parses Retry-After header with HTTP-date', () => {
      const futureDate = new Date(Date.now() + 120000); // 120 seconds in future
      vi.spyOn(Date, 'now').mockReturnValue(futureDate.getTime() - 120000);

      const headers = new Headers({
        'Retry-After': futureDate.toUTCString(),
      });

      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).not.toBeNull();
      expect(result!.resetRequestsMs).toBeGreaterThan(0);
      expect(result!.resetRequestsMs).toBeLessThanOrEqual(120000);
    });

    it('clamps reset to 0 when HTTP-date is in the past', () => {
      const pastDate = new Date(Date.now() - 60000); // 60 seconds in past
      const headers = new Headers({
        'Retry-After': pastDate.toUTCString(),
      });

      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        resetRequestsMs: 0,
      });
    });

    it('returns null for invalid Retry-After value', () => {
      const headers = new Headers({
        'Retry-After': 'invalid',
      });

      const adapter = new GoogleAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });
  });

  describe('prepareRequestBody (system message handling)', () => {
    let adapter: GoogleAIAdapter;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      adapter = new GoogleAIAdapter('test', 'Test', 'key');
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('merges system messages into first user message for gemma models', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(makeResponse()), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await adapter.chatCompletion('gemma-3-27b-it', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.messages).toEqual([
        { role: 'user', content: 'You are helpful.\n\nHello' },
      ]);
    });

    it('merges multiple system messages into first user message', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(makeResponse()), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'system', content: 'Speak in French.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Bonjour' },
        ],
      };

      await adapter.chatCompletion('gemma-3-27b-it', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.messages).toEqual([
        { role: 'user', content: 'Be concise.\nSpeak in French.\n\nHi' },
        { role: 'assistant', content: 'Bonjour' },
      ]);
    });

    it('preserves system messages for gemini models', async () => {
      const geminiResponse = { ...makeResponse(), model: 'gemini-2.0-flash' };
      fetchMock.mockResolvedValue(new Response(JSON.stringify(geminiResponse), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      };

      await adapter.chatCompletion('gemini-2.0-flash', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.messages).toEqual([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('passes through unchanged when no system messages for gemma', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(makeResponse()), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [
          { role: 'user', content: 'Hello' },
        ],
      };

      await adapter.chatCompletion('gemma-3-27b-it', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.messages).toEqual([
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('strips response_format, tools, and tool_choice for gemma models', async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(makeResponse()), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [{ role: 'user', content: 'Hello' }],
        response_format: { type: 'json_object' },
        tools: [{ type: 'function', function: { name: 'test', description: 'test' } }],
        tool_choice: 'auto',
        temperature: 0.7,
      };

      await adapter.chatCompletion('gemma-3-27b-it', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody).not.toHaveProperty('response_format');
      expect(sentBody).not.toHaveProperty('tools');
      expect(sentBody).not.toHaveProperty('tool_choice');
      expect(sentBody.temperature).toBe(0.7);
    });

    it('preserves response_format and tools for gemini models', async () => {
      const geminiResponse = { ...makeResponse(), model: 'gemini-2.0-flash' };
      fetchMock.mockResolvedValue(new Response(JSON.stringify(geminiResponse), { status: 200 }));

      const request: ChatCompletionRequest = {
        model: 'ignored',
        messages: [{ role: 'user', content: 'Hello' }],
        response_format: { type: 'json_object' },
        tools: [{ type: 'function', function: { name: 'test', description: 'test' } }],
        tool_choice: 'auto',
      };

      await adapter.chatCompletion('gemini-2.0-flash', request);

      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.response_format).toEqual({ type: 'json_object' });
      expect(sentBody.tools).toHaveLength(1);
      expect(sentBody.tool_choice).toBe('auto');
    });
  });
});
