import { describe, it, expect, vi, afterEach } from 'vitest';
import { GoogleAIAdapter } from '../google-ai.js';

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
});
