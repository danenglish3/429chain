import { describe, it, expect } from 'vitest';
import {
  ConfigError,
  ProviderError,
  ProviderRateLimitError,
  AllProvidersExhaustedError,
} from '../errors.js';
import type { AttemptRecord } from '../types.js';

describe('ConfigError', () => {
  it('creates an error with the correct name and message', () => {
    const err = new ConfigError('Bad config');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.name).toBe('ConfigError');
    expect(err.message).toBe('Bad config');
  });
});

describe('ProviderError', () => {
  it('creates an error with provider details', () => {
    const err = new ProviderError('groq', 'llama-3.1-8b', 500, '{"error":"internal"}');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe('ProviderError');
    expect(err.providerId).toBe('groq');
    expect(err.model).toBe('llama-3.1-8b');
    expect(err.statusCode).toBe(500);
    expect(err.responseBody).toBe('{"error":"internal"}');
    expect(err.message).toContain('groq');
    expect(err.message).toContain('500');
  });
});

describe('ProviderRateLimitError', () => {
  it('creates a 429 error with headers', () => {
    const headers = new Headers({ 'retry-after': '60' });
    const err = new ProviderRateLimitError('openrouter', 'llama-3.1-8b', headers);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect(err.name).toBe('ProviderRateLimitError');
    expect(err.statusCode).toBe(429);
    expect(err.headers.get('retry-after')).toBe('60');
  });
});

describe('AllProvidersExhaustedError', () => {
  it('creates an error with attempt details', () => {
    const attempts: AttemptRecord[] = [
      { provider: 'openrouter', model: 'llama-3.1-8b', error: '429_rate_limited', retryAfter: 60 },
      { provider: 'groq', model: 'llama-3.1-8b-instant', error: '429_rate_limited' },
      { provider: 'cerebras', model: 'llama-3.1-8b', error: 'on_cooldown', skipped: true },
    ];

    const err = new AllProvidersExhaustedError('default', attempts);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AllProvidersExhaustedError');
    expect(err.attempts).toHaveLength(3);
    expect(err.message).toContain('default');
    expect(err.message).toContain('openrouter/llama-3.1-8b');
    expect(err.message).toContain('skipped (on cooldown)');
  });

  it('produces OpenAI-format error response', () => {
    const attempts: AttemptRecord[] = [
      { provider: 'groq', model: 'llama-3.1-8b-instant', error: '429_rate_limited' },
    ];

    const err = new AllProvidersExhaustedError('default', attempts);
    const openAIError = err.toOpenAIError();

    expect(openAIError.error.type).toBe('server_error');
    expect(openAIError.error.code).toBe('all_providers_exhausted');
    expect(openAIError.error.param).toBeNull();
    expect(openAIError.error.message).toContain('All providers exhausted');
  });
});
