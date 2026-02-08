import { describe, it, expect } from 'vitest';
import { normalizeResponse, normalizeChunk } from '../normalize.js';
import type { ChatCompletionResponse, ChatCompletionChunk } from '../types.js';

describe('normalizeResponse', () => {
  it('moves reasoning_content to content when content is null', () => {
    const response: ChatCompletionResponse = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: 'Let me think... The answer is 42.',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    normalizeResponse(response);

    expect(response.choices[0].message.content).toBe('Let me think... The answer is 42.');
    expect(response.choices[0].message.reasoning_content).toBeUndefined();
  });

  it('moves reasoning_content to content when content is empty string', () => {
    const response: ChatCompletionResponse = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: 'Thinking step by step...',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    normalizeResponse(response);

    expect(response.choices[0].message.content).toBe('Thinking step by step...');
    expect(response.choices[0].message.reasoning_content).toBeUndefined();
  });

  it('does NOT overwrite existing content', () => {
    const response: ChatCompletionResponse = {
      id: 'chatcmpl-789',
      object: 'chat.completion',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'The answer is 42.',
            reasoning_content: 'Hidden reasoning...',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    normalizeResponse(response);

    // Both fields should be preserved when content has a value
    expect(response.choices[0].message.content).toBe('The answer is 42.');
    expect(response.choices[0].message.reasoning_content).toBe('Hidden reasoning...');
  });

  it('no-ops when reasoning_content is absent', () => {
    const response: ChatCompletionResponse = {
      id: 'chatcmpl-abc',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Normal response',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    normalizeResponse(response);

    expect(response.choices[0].message.content).toBe('Normal response');
    expect(response.choices[0].message.reasoning_content).toBeUndefined();
  });

  it('handles multiple choices', () => {
    const response: ChatCompletionResponse = {
      id: 'chatcmpl-multi',
      object: 'chat.completion',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            reasoning_content: 'First reasoning',
          },
          finish_reason: 'stop',
        },
        {
          index: 1,
          message: {
            role: 'assistant',
            content: 'Normal answer',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    normalizeResponse(response);

    // First choice: reasoning_content moved to content
    expect(response.choices[0].message.content).toBe('First reasoning');
    expect(response.choices[0].message.reasoning_content).toBeUndefined();

    // Second choice: unchanged
    expect(response.choices[1].message.content).toBe('Normal answer');
    expect(response.choices[1].message.reasoning_content).toBeUndefined();
  });
});

describe('normalizeChunk', () => {
  it('moves delta.reasoning_content to delta.content when content is undefined', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chatcmpl-stream-1',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: 'Thinking...',
          },
          finish_reason: null,
        },
      ],
    };

    const input = JSON.stringify(chunk);
    const output = normalizeChunk(input);
    const parsed = JSON.parse(output) as ChatCompletionChunk;

    expect(parsed.choices[0].delta.content).toBe('Thinking...');
    expect(parsed.choices[0].delta.reasoning_content).toBeUndefined();
  });

  it('moves delta.reasoning_content to delta.content when content is null', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chatcmpl-stream-2',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          delta: {
            content: null,
            reasoning_content: 'Step 1...',
          },
          finish_reason: null,
        },
      ],
    };

    const input = JSON.stringify(chunk);
    const output = normalizeChunk(input);
    const parsed = JSON.parse(output) as ChatCompletionChunk;

    expect(parsed.choices[0].delta.content).toBe('Step 1...');
    expect(parsed.choices[0].delta.reasoning_content).toBeUndefined();
  });

  it('does NOT overwrite existing delta.content', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chatcmpl-stream-3',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          delta: {
            content: 'Real answer',
            reasoning_content: 'Hidden thinking',
          },
          finish_reason: null,
        },
      ],
    };

    const input = JSON.stringify(chunk);
    const output = normalizeChunk(input);
    const parsed = JSON.parse(output) as ChatCompletionChunk;

    // Both preserved when content exists
    expect(parsed.choices[0].delta.content).toBe('Real answer');
    expect(parsed.choices[0].delta.reasoning_content).toBe('Hidden thinking');
  });

  it('returns [DONE] unchanged', () => {
    const result = normalizeChunk('[DONE]');
    expect(result).toBe('[DONE]');
  });

  it('returns malformed JSON unchanged', () => {
    const malformed = 'not json at all';
    const result = normalizeChunk(malformed);
    expect(result).toBe(malformed);
  });

  it('handles chunk with no choices gracefully', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chatcmpl-empty',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [],
    };

    const input = JSON.stringify(chunk);
    const output = normalizeChunk(input);
    const parsed = JSON.parse(output) as ChatCompletionChunk;

    expect(parsed.choices).toHaveLength(0);
  });

  it('handles chunk with empty delta gracefully', () => {
    const chunk: ChatCompletionChunk = {
      id: 'chatcmpl-empty-delta',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'deepseek-r1',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: null,
        },
      ],
    };

    const input = JSON.stringify(chunk);
    const output = normalizeChunk(input);
    const parsed = JSON.parse(output) as ChatCompletionChunk;

    expect(parsed.choices[0].delta.content).toBeUndefined();
    expect(parsed.choices[0].delta.reasoning_content).toBeUndefined();
  });
});
