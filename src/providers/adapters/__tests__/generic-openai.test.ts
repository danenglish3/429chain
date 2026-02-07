import { describe, it, expect } from 'vitest';
import { GenericOpenAIAdapter } from '../generic-openai.js';

describe('GenericOpenAIAdapter', () => {
  describe('parseRateLimitHeaders', () => {
    it('parses all 5 headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests': '500',
        'x-ratelimit-remaining-requests': '499',
        'x-ratelimit-limit-tokens': '100000',
        'x-ratelimit-remaining-tokens': '99000',
        'retry-after': '2.5',
      });

      const adapter = new GenericOpenAIAdapter('test', 'Test', 'key', 'https://custom.api.com/v1');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 500,
        remainingRequests: 499,
        limitTokens: 100000,
        remainingTokens: 99000,
        retryAfterMs: 2500,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new GenericOpenAIAdapter('test', 'Test', 'key', 'https://custom.api.com/v1');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('parses partial headers correctly', () => {
      const headers = new Headers({
        'retry-after': '10',
      });

      const adapter = new GenericOpenAIAdapter('test', 'Test', 'key', 'https://custom.api.com/v1');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        retryAfterMs: 10000,
      });
    });
  });

  describe('constructor', () => {
    it('requires baseUrl (no default)', () => {
      const adapter = new GenericOpenAIAdapter('test', 'Test', 'key', 'https://custom.api.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.api.com/v1');
    });
  });
});
