import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenRouterAdapter } from '../openrouter.js';

describe('OpenRouterAdapter', () => {
  describe('getExtraHeaders', () => {
    it('returns HTTP-Referer and X-Title headers', () => {
      const adapter = new OpenRouterAdapter('test', 'Test', 'key');
      const headers = adapter.getExtraHeaders();

      expect(headers).toEqual({
        'HTTP-Referer': '429chain',
        'X-Title': '429chain',
      });
    });
  });

  describe('parseRateLimitHeaders', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('parses all 3 headers correctly with future reset timestamp', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000000);

      const headers = new Headers({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '95',
        'X-RateLimit-Reset': '1060000', // 60 seconds in future
      });

      const adapter = new OpenRouterAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 100,
        remainingRequests: 95,
        resetRequestsMs: 60000,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new OpenRouterAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('clamps reset to 0 when timestamp is in the past', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000000);

      const headers = new Headers({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '95',
        'X-RateLimit-Reset': '900000', // 100 seconds in past
      });

      const adapter = new OpenRouterAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 100,
        remainingRequests: 95,
        resetRequestsMs: 0,
      });
    });
  });

  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new OpenRouterAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://openrouter.ai/api/v1');
    });

    it('uses provided base URL when given', () => {
      const adapter = new OpenRouterAdapter('test', 'Test', 'key', 'https://custom.openrouter.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.openrouter.com/v1');
    });
  });
});
