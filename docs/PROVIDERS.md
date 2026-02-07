# Provider Adapter Guide

429chain uses a provider adapter system to support multiple AI providers. This guide explains how to add support for new providers.

There are two paths to add a provider:
1. **Quick path**: Use `generic-openai` type in config (for OpenAI-compatible providers)
2. **Full path**: Create a custom adapter class (for providers with non-standard behavior)

## Quick Path: generic-openai

Any provider that follows the OpenAI API specification can be added through configuration alone, without writing code.

### Configuration

Add a provider to your `config.yaml` with `type: generic-openai` and a `baseUrl` pointing to the provider's endpoint:

```yaml
providers:
  - id: together
    name: Together AI
    type: generic-openai
    apiKey: ${TOGETHER_API_KEY}
    baseUrl: https://api.together.xyz/v1

  - id: fireworks
    name: Fireworks AI
    type: generic-openai
    apiKey: ${FIREWORKS_API_KEY}
    baseUrl: https://api.fireworks.ai/inference/v1
```

**Important**: `baseUrl` is REQUIRED for `generic-openai` type. Other types have defaults, but generic-openai needs an explicit URL.

### What You Get

The `GenericOpenAIAdapter` provides:

- Chat completions via `/chat/completions` endpoint
- Streaming support with Server-Sent Events
- Standard rate limit header parsing:
  - `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests`
  - `x-ratelimit-limit-tokens` / `x-ratelimit-remaining-tokens`
  - `retry-after` (seconds)

### What You Don't Get

Generic adapters cannot:

- Parse custom rate limit header formats
- Strip provider-specific unsupported parameters
- Add required extra headers (beyond Authorization)

If your provider needs any of these, use the full custom adapter path.

### Examples

Providers that work with `generic-openai`:

- **Together AI**: `https://api.together.xyz/v1`
- **Fireworks AI**: `https://api.fireworks.ai/inference/v1`
- **DeepInfra**: `https://api.deepinfra.com/v1/openai`
- **Moonshot AI**: `https://api.moonshot.ai/v1`
- Any provider with a `/v1/chat/completions` endpoint following OpenAI's spec

## Full Path: Custom Adapter

For providers with non-standard behavior, create a custom adapter class. We'll walk through creating an adapter for a hypothetical "Acme AI" provider.

### Step 1: Create the Adapter File

Create `src/providers/adapters/acme.ts`:

```typescript
/**
 * Acme AI adapter.
 * Handles Acme-specific rate limit header parsing and parameter handling.
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';
import type { ChatCompletionRequest } from '../../shared/types.js';

const DEFAULT_BASE_URL = 'https://api.acme.ai/v1';

export class AcmeAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string) {
    super(id, 'acme', name, apiKey, baseUrl ?? DEFAULT_BASE_URL);
  }

  /**
   * Parse Acme rate limit headers.
   * REQUIRED: This abstract method must be implemented.
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    // Implementation in Step 2
    return null;
  }

  /**
   * Prepare request body for Acme.
   * OPTIONAL: Override only if provider rejects certain parameters.
   */
  protected override prepareRequestBody(
    model: string,
    body: ChatCompletionRequest,
  ): Record<string, unknown> {
    // Implementation in Step 3 (if needed)
    return super.prepareRequestBody(model, body);
  }

  /**
   * Get Acme-specific headers.
   * OPTIONAL: Override only if provider requires additional headers.
   */
  override getExtraHeaders(): Record<string, string> {
    // Implementation in Step 4 (if needed)
    return {};
  }
}
```

### Step 2: Implement parseRateLimitHeaders() [REQUIRED]

Every adapter must implement `parseRateLimitHeaders()` to parse the provider's rate limit headers into the normalized `RateLimitInfo` format.

**RateLimitInfo interface:**

```typescript
interface RateLimitInfo {
  limitRequests?: number;        // Max requests in window
  remainingRequests?: number;    // Requests remaining
  resetRequestsMs?: number;      // Ms until request limit resets
  limitTokens?: number;          // Max tokens in window
  remainingTokens?: number;      // Tokens remaining
  resetTokensMs?: number;        // Ms until token limit resets
  retryAfterMs?: number;         // Explicit retry-after from 429 response
}
```

**Provider header format examples:**

Each provider uses different headers. Here are real examples from the codebase:

**Groq** parses duration strings like `"6m23.456s"`:

```typescript
// Headers: x-ratelimit-reset-requests: "6m23.456s"
override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const resetReq = headers.get('x-ratelimit-reset-requests');
  if (resetReq !== null) {
    info.resetRequestsMs = parseDurationToMs(resetReq); // Custom parser
  }
  // ... parse other headers
}
```

**OpenRouter** uses Unix timestamps in milliseconds:

```typescript
// Headers: X-RateLimit-Reset: "1708534890000" (Unix timestamp in ms)
override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const reset = headers.get('x-ratelimit-reset');
  if (reset !== null) {
    const resetMs = parseInt(reset, 10);
    const now = Date.now();
    info.resetRequestsMs = Math.max(0, resetMs - now); // Convert to ms-from-now
  }
  // ... parse other headers
}
```

**Cerebras** uses separate headers for day/minute limits:

```typescript
// Headers: x-ratelimit-limit-requests-day, x-ratelimit-limit-tokens-minute
override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  const limitReqDay = headers.get('x-ratelimit-limit-requests-day');
  const limitTokMin = headers.get('x-ratelimit-limit-tokens-minute');
  // ... parse both day and minute headers
}
```

**Implementation pattern:**

```typescript
override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
  // 1. Read all relevant headers
  const limitReq = headers.get('x-acme-limit-requests');
  const remainingReq = headers.get('x-acme-remaining-requests');
  const resetReq = headers.get('x-acme-reset-requests');
  const retryAfter = headers.get('retry-after');

  // 2. Return null if no recognized headers present
  if (limitReq === null && remainingReq === null &&
      resetReq === null && retryAfter === null) {
    return null;
  }

  // 3. Build RateLimitInfo object
  const info: RateLimitInfo = {};

  if (limitReq !== null) {
    const parsed = parseInt(limitReq, 10);
    if (!isNaN(parsed)) info.limitRequests = parsed;
  }

  if (remainingReq !== null) {
    const parsed = parseInt(remainingReq, 10);
    if (!isNaN(parsed)) info.remainingRequests = parsed;
  }

  if (resetReq !== null) {
    const seconds = parseFloat(resetReq);
    if (!isNaN(seconds)) {
      info.resetRequestsMs = Math.round(seconds * 1000);
    }
  }

  if (retryAfter !== null) {
    const seconds = parseFloat(retryAfter);
    if (!isNaN(seconds)) {
      info.retryAfterMs = Math.round(seconds * 1000);
    }
  }

  return info;
}
```

### Step 3: Override prepareRequestBody() [OPTIONAL]

Override this method only if the provider rejects certain OpenAI parameters.

**When to use**: Provider returns errors for parameters like `presence_penalty`, `frequency_penalty`, `logit_bias`, etc.

**Cerebras example** (strips unsupported penalty parameters):

```typescript
protected override prepareRequestBody(
  model: string,
  body: ChatCompletionRequest,
): Record<string, unknown> {
  const { model: _originalModel, ...rest } = body;
  const prepared: Record<string, unknown> = { ...rest, model, stream: false };

  // Strip unsupported parameters
  const unsupportedParams = ['presence_penalty', 'frequency_penalty'];
  for (const param of unsupportedParams) {
    if (param in prepared) {
      logger.debug(
        { provider: this.id, model, param },
        'Stripping unsupported parameter',
      );
      delete prepared[param];
    }
  }

  return prepared;
}
```

**Template:**

```typescript
protected override prepareRequestBody(
  model: string,
  body: ChatCompletionRequest,
): Record<string, unknown> {
  // Option 1: Call super and modify
  const prepared = super.prepareRequestBody(model, body);
  delete prepared.unsupported_param;
  return prepared;

  // Option 2: Manual destructure
  const { model: _originalModel, unsupported_param, ...rest } = body;
  return { ...rest, model, stream: false };
}
```

### Step 4: Override getExtraHeaders() [OPTIONAL]

Override this method only if the provider requires additional headers beyond `Authorization`.

**When to use**: Provider needs API version headers, referer headers, or other custom headers on every request.

**OpenRouter example** (requires referer headers):

```typescript
override getExtraHeaders(): Record<string, string> {
  return {
    'HTTP-Referer': '429chain',
    'X-Title': '429chain',
  };
}
```

**Template:**

```typescript
override getExtraHeaders(): Record<string, string> {
  return {
    'X-API-Version': '2024-01',
    'X-Custom-Header': 'value',
  };
}
```

### Step 5: Register the Adapter

Two files must be updated to register your adapter:

#### 5a. Update src/providers/registry.ts

Import your adapter and add a case to the `createAdapter` switch statement:

```typescript
// Add import at top
import { AcmeAdapter } from './adapters/acme.js';

// Add case in createAdapter function
export function createAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.type) {
    case 'openrouter':
      return new OpenRouterAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'groq':
      return new GroqAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'cerebras':
      return new CerebrasAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'openai':
      return new OpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'generic-openai':
      if (!config.baseUrl) {
        throw new ConfigError(
          `Provider '${config.id}' (generic-openai) requires a baseUrl`,
        );
      }
      return new GenericOpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl);

    // ADD YOUR ADAPTER HERE
    case 'acme':
      return new AcmeAdapter(config.id, config.name, config.apiKey, config.baseUrl);

    default:
      throw new ConfigError(
        `Unknown provider type '${config.type}' for provider '${config.id}'. ` +
        `Supported types: openrouter, groq, cerebras, openai, generic-openai, acme`,
      );
  }
}
```

#### 5b. Update src/config/schema.ts

Add your provider type to the `z.enum()` array in the `ProviderSchema`:

```typescript
export const ProviderSchema = z.object({
  id: z.string().min(1, { message: 'Provider id must not be empty' }),
  name: z.string().min(1, { message: 'Provider name must not be empty' }),

  // ADD YOUR TYPE HERE
  type: z.enum(['openrouter', 'groq', 'cerebras', 'openai', 'generic-openai', 'acme']),

  apiKey: z.string().min(1, { message: 'Provider apiKey must not be empty' }),
  baseUrl: z.url({ message: 'Provider baseUrl must be a valid URL' }).optional(),
  rateLimits: RateLimitConfigSchema.optional(),
});
```

### Step 6: Write Tests

Create `src/providers/adapters/__tests__/acme.test.ts` following the existing test patterns:

```typescript
import { describe, it, expect } from 'vitest';
import { AcmeAdapter } from '../acme.js';

describe('AcmeAdapter', () => {
  describe('constructor', () => {
    it('sets default base URL when not provided', () => {
      const adapter = new AcmeAdapter('test', 'Test', 'key');
      expect(adapter.baseUrl).toBe('https://api.acme.ai/v1');
    });

    it('uses provided base URL when given', () => {
      const adapter = new AcmeAdapter('test', 'Test', 'key', 'https://custom.acme.ai/v1');
      expect(adapter.baseUrl).toBe('https://custom.acme.ai/v1');
    });
  });

  describe('parseRateLimitHeaders', () => {
    it('parses all headers correctly', () => {
      const headers = new Headers({
        'x-acme-limit-requests': '1000',
        'x-acme-remaining-requests': '999',
        'x-acme-reset-requests': '60',
        'retry-after': '5',
      });

      const adapter = new AcmeAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 1000,
        remainingRequests: 999,
        resetRequestsMs: 60000,
        retryAfterMs: 5000,
      });
    });

    it('returns null when no headers are present', () => {
      const headers = new Headers();
      const adapter = new AcmeAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toBeNull();
    });

    it('parses partial headers correctly', () => {
      const headers = new Headers({
        'x-acme-limit-requests': '100',
      });

      const adapter = new AcmeAdapter('test', 'Test', 'key');
      const result = adapter.parseRateLimitHeaders(headers);

      expect(result).toEqual({
        limitRequests: 100,
      });
    });
  });

  describe('prepareRequestBody', () => {
    // Only if you override prepareRequestBody
    it('strips unsupported parameters', () => {
      const adapter = new AcmeAdapter('test', 'Test', 'key');
      const body = {
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-3.5-turbo',
        unsupported_param: 'value',
      };

      const result = adapter['prepareRequestBody']('acme-model-1', body);

      expect(result).not.toHaveProperty('unsupported_param');
      expect(result.model).toBe('acme-model-1');
    });
  });
});
```

Run tests:

```bash
npm test src/providers/adapters/__tests__/acme.test.ts
```

## Architecture Reference

Understanding the adapter architecture helps when debugging or extending functionality.

### BaseAdapter Responsibilities

`BaseAdapter` handles all HTTP logic:

- Constructs URLs (`${baseUrl}/chat/completions`)
- Sets headers (`Content-Type`, `Authorization`, plus `getExtraHeaders()`)
- Makes fetch requests with optional AbortSignal
- Measures latency with `performance.now()`
- Detects 429 responses and throws `ProviderRateLimitError`
- Detects other errors and throws `ProviderError`

Adapters never directly use `fetch()` - they only implement parsing and body preparation.

### Waterfall Flow

When a request comes in:

1. **Config YAML** defines providers and chains
2. **buildRegistry()** creates adapter instances via `createAdapter()` switch
3. **Chain router** executes the chain waterfall:
   - Try provider 1
   - On 429, `ProviderRateLimitError` is thrown
   - Catch error, try provider 2
   - Repeat until success or all exhausted
4. **Rate limit tracker** calls `adapter.parseRateLimitHeaders()` to update quota state

### Flow Diagram

```
config.yaml
    |
    v
buildRegistry()
    |
    v
createAdapter() switch
    |
    v
Adapter instance (OpenRouterAdapter, GroqAdapter, etc.)
    |
    v
Chain router uses adapter.chatCompletion() / chatCompletionStream()
    |
    v
BaseAdapter handles HTTP, adapter handles parsing
```

## Checklist

Use this checklist when adding a new provider adapter:

- [ ] Adapter file created at `src/providers/adapters/{name}.ts`
- [ ] Extends `BaseAdapter` with correct constructor signature
- [ ] `parseRateLimitHeaders()` implemented (REQUIRED)
- [ ] `prepareRequestBody()` overridden (if provider rejects certain parameters)
- [ ] `getExtraHeaders()` overridden (if provider requires extra headers)
- [ ] Import added to `src/providers/registry.ts`
- [ ] Case added to `createAdapter()` switch in `src/providers/registry.ts`
- [ ] Type added to `z.enum()` in `src/config/schema.ts` `ProviderSchema`
- [ ] Tests created at `src/providers/adapters/__tests__/{name}.test.ts`
- [ ] Tests cover: constructor defaults, parseRateLimitHeaders with all/no/partial headers
- [ ] Tests cover parameter stripping if `prepareRequestBody` is overridden
- [ ] All tests passing (`npm test`)
- [ ] Config YAML updated with new provider definition
- [ ] Provider tested with actual API credentials
- [ ] Error messages in `createAdapter()` default case updated to include new type (in both registry.ts and docs)

## Next Steps

After adding your adapter:

1. Add the provider to your `config.yaml`
2. Add it to a chain or create a new chain
3. Test with real requests: `curl http://localhost:3429/v1/chat/completions`
4. Monitor logs for rate limit header parsing: `logLevel: debug`
5. Verify rate limit tracking works by checking UI or logs

For questions or issues, check existing adapters in `src/providers/adapters/` as reference implementations.
