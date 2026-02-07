import { describe, it, expect } from 'vitest';
import { parseDurationToMs, GroqAdapter } from '../groq.js';

describe('parseDurationToMs', () => {
  it('parses complex duration "6m23.456s"', () => {
    expect(parseDurationToMs('6m23.456s')).toBe(383456);
  });

  it('parses decimal seconds "1.5s"', () => {
    expect(parseDurationToMs('1.5s')).toBe(1500);
  });

  it('parses minutes and seconds "2m0s"', () => {
    expect(parseDurationToMs('2m0s')).toBe(120000);
  });

  it('parses zero duration "0s"', () => {
    expect(parseDurationToMs('0s')).toBe(0);
  });

  it('parses milliseconds "500ms"', () => {
    expect(parseDurationToMs('500ms')).toBe(500);
  });

  it('parses hours, minutes, and seconds "2h30m0s"', () => {
    expect(parseDurationToMs('2h30m0s')).toBe(9000000);
  });

  it('parses simple seconds "10s"', () => {
    expect(parseDurationToMs('10s')).toBe(10000);
  });
});

describe('GroqAdapter', () => {
  describe('parseRateLimitHeaders', () => {
    it('parses all 7 headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests': '14400',
        'x-ratelimit-remaining-requests': '14399',
        'x-ratelimit-reset-requests': '6m23.456s',
        'x-ratelimit-limit-tokens': '18000',
        'x-ratelimit-remaining-tokens': '17500',
        'x-ratelimit-reset-tokens': '1.5s',
        'retry-after': '8.12',
      });

      const adapter = new GroqAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 14400,
        remainingRequests: 14399,
        resetRequestsMs: 383456,
        limitTokens: 18000,
        remainingTokens: 17500,
        resetTokensMs: 1500,
        retryAfterMs: 8120,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new GroqAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('parses partial headers correctly', () => {
      const headers = new Headers({
        'x-ratelimit-limit-requests': '100',
        'retry-after': '5',
      });

      const adapter = new GroqAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 100,
        retryAfterMs: 5000,
      });
    });
  });

  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new GroqAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://api.groq.com/openai/v1');
    });

    it('uses provided base URL when given', () => {
      const adapter = new GroqAdapter('test', 'Test', 'key', 'https://custom.groq.com/v1');
      expect(adapter.baseUrl).toBe('https://custom.groq.com/v1');
    });
  });
});
