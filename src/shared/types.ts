/**
 * OpenAI-compatible request/response type definitions.
 * These types define the contract between the proxy and its clients.
 */

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** A tool call within an assistant message. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Tool definition for function calling. */
export interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** OpenAI-compatible chat completion request body. */
export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
  n?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
}

/** A single choice in a chat completion response. */
export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

/** Token usage statistics. */
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** OpenAI-compatible chat completion response. */
export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: Usage;
  system_fingerprint?: string;
}

/** OpenAI-compatible error response. */
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

/** OpenAI-compatible models list response. */
export interface ModelsResponse {
  object: 'list';
  data: ModelInfo[];
}

/** A single model entry in the models list. */
export interface ModelInfo {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

/** Record of a single provider attempt during chain execution. */
export interface AttemptRecord {
  provider: string;
  model: string;
  error: string;
  skipped?: boolean;
  retryAfter?: number;
}
