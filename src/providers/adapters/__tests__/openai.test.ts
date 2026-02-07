import { describe, it, expect } from 'vitest';
import { OpenAIAdapter } from '../openai.js';

describe('OpenAIAdapter', () => {
  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new OpenAIAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('uses provided base URL when given', () => {
      const adapter = new OpenAIAdapter('test', 'Test', 'key', 'https://custom.openai.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.openai.com/v1');
    });
  });

  describe('parseRateLimitHeaders', () => {
    it('parses all 7 headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests': '10000',
        'x-ratelimit-remaining-requests': '9999',
        'x-ratelimit-reset-requests': '2m30s',
        'x-ratelimit-limit-tokens': '200000',
        'x-ratelimit-remaining-tokens': '195000',
        'x-ratelimit-reset-tokens': '45.5s',
        'retry-after': '3.5',
      });

      const adapter = new OpenAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 10000,
        remainingRequests: 9999,
        resetRequestsMs: 150000,
        limitTokens: 200000,
        remainingTokens: 195000,
        resetTokensMs: 45500,
        retryAfterMs: 3500,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new OpenAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('parses partial headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests': '100',
        'retry-after': '5',
      });

      const adapter = new OpenAIAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 100,
        retryAfterMs: 5000,
      });
    });
  });
});
