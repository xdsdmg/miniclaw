/**
 * LLM Layer — Core Type Definitions
 *
 * Architecture inspired by pi-ai (@earendil-works/pi):
 * - Provider as factory function
 * - Model as first-class data object
 * - Api as type-level protocol discriminator
 * - Compat override system for API differences
 * - Auth as provider property
 */

// ─── Api Protocol Type ───────────────────────────────────────────────────────

/**
 * Known API protocols. Each value maps to a stream implementation.
 *
 * - "openai-completions":  OpenAI Chat Completions API (also covers DeepSeek, Kimi, Qwen)
 * - "anthropic-messages":  Anthropic Messages API (reserved)
 * - "openai-responses":    OpenAI Responses API (reserved)
 * - "google-gemini":       Google Gemini API (reserved)
 */
export type KnownApi =
  | 'openai-completions'
  | 'anthropic-messages'
  | 'openai-responses'
  | 'google-gemini';

/** Any API string — allows custom API protocols. */
export type Api = KnownApi | (string & {});

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * A provider is the concrete runtime unit. It owns id/name/baseUrl metadata,
 * auth methods, model listing, and stream behavior.
 *
 * `TApi` lets concrete provider factories declare which API protocol they use
 * (e.g. `deepseekProvider(): Provider<"openai-completions">`).
 */
export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;
  /** Default base URL (user config can override) */
  readonly baseUrl?: string;
  /** Auth declaration — how this provider authenticates */
  readonly auth: ProviderAuth;
  /** Current known models, synchronous */
  getModels(): readonly Model<TApi>[];
  /**
   * Stream an LLM response. This is the fundamental I/O operation;
   * non-streaming is derived via complete().
   */
  stream(model: Model<TApi>, context: Context, options?: StreamOptions): EventStream;
  /** Convenience: stream and aggregate into a single AssistantMessage */
  complete?(model: Model<TApi>, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

// ─── Model ───────────────────────────────────────────────────────────────────

/**
 * A model is a first-class data object with full metadata.
 */
export interface Model<TApi extends Api = Api> {
  /** Model identifier, e.g. "deepseek-v4-flash" */
  id: string;
  /** Human-readable name */
  name: string;
  /** API protocol this model speaks */
  api: TApi;
  /** Provider id this model belongs to */
  provider: string;
  /** API endpoint base URL */
  baseUrl: string;
  /** Capability flags */
  capabilities: {
    /** Supports tool/function calling */
    tools: boolean;
    /** Supports streaming */
    streaming: boolean;
    /** Supports reasoning/thinking */
    thinking: boolean;
  };
  /** Compatibility overrides (type-level dispatch via TApi) */
  compat?: TApi extends 'openai-completions'
    ? OpenAICompletionsCompat
    : TApi extends 'anthropic-messages'
      ? AnthropicMessagesCompat
      : never;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxTokens: number;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Provider auth declaration. Each provider declares which environment
 * variables can supply its API key, and how to check if it is configured.
 */
export interface ProviderAuth {
  /** Environment variable names to check for an API key */
  apiKeyEnvVars: string[];
  /** Check whether this provider is configured (env var present / user logged in) */
  isConfigured(): boolean;
}

// ─── Stream Options ──────────────────────────────────────────────────────────

/** Per-request stream options — all optional, override provider defaults. */
export interface StreamOptions {
  /** Model override (use a different model for this request) */
  model?: string;
  /** Temperature override */
  temperature?: number;
  /** Max output tokens override */
  maxTokens?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** API key override */
  apiKey?: string;
  /** Base URL override */
  baseUrl?: string;
  /** Reasoning/thinking effort level */
  reasoning?: ThinkingLevel;
  /** Custom HTTP headers */
  headers?: Record<string, string | null>;
  /** Callback to inspect/replace the request payload before sending */
  onPayload?: (payload: unknown) => unknown | undefined;
  /** Callback after HTTP response received (before body stream consumed) */
  onResponse?: (response: { status: number; headers: Record<string, string> }) => void;
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Max retries for transient failures */
  maxRetries?: number;
}

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ModelThinkingLevel = 'off' | ThinkingLevel;

// ─── Compat — OpenAI Completions ─────────────────────────────────────────────

/**
 * Declarative flags describing differences between various OpenAI-compatible APIs.
 * Avoids hardcoding provider-specific behavior in switch statements.
 */
export interface OpenAICompletionsCompat {
  /** Field name for max tokens: "max_completion_tokens" | "max_tokens" */
  maxTokensField?: 'max_completion_tokens' | 'max_tokens';
  /** Whether the API supports the reasoning_effort parameter */
  supportsReasoningEffort?: boolean;
  /** Thinking/Reasoning parameter format */
  thinkingFormat?: 'openai' | 'deepseek' | 'zai' | 'qwen';
  /** Whether the API supports the "system" role (vs requiring "developer") */
  supportsSystemRole?: boolean;
  /** Whether the API supports strict mode in tool definitions */
  supportsStrictTools?: boolean;
  /** Whether streaming responses include token usage */
  supportsUsageInStreaming?: boolean;
}

// ─── Compat — Anthropic Messages ─────────────────────────────────────────────

export interface AnthropicMessagesCompat {
  /** Whether per-tool eager_input_streaming is supported */
  supportsEagerToolInputStreaming?: boolean;
  /** Whether long cache retention (cache_control.ttl: "1h") is supported */
  supportsLongCacheRetention?: boolean;
}

// ─── Context & Messages ──────────────────────────────────────────────────────

/** Unified LLM context: system prompt + messages + tools. */
export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: 'assistant';
  content: ContentBlock[];
  api?: Api;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: StopReason;
  errorMessage?: string;
}

export interface ToolResultMessage {
  role: 'tool';
  toolCallId: string;
  toolName: string;
  content: string | ContentBlock[];
  isError?: boolean;
}

// ─── Content Blocks ──────────────────────────────────────────────────────────

export type ContentBlock = TextContent | ThinkingContent | ToolCallContent | ImageContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  /** Whether the thinking was redacted by safety filters */
  redacted?: boolean;
}

export interface ToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ─── Usage & Stop Reasons ────────────────────────────────────────────────────

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens (subset of output) */
  reasoning?: number;
  totalTokens: number;
}

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

// ─── Event Stream ────────────────────────────────────────────────────────────

/**
 * Protocol for streaming LLM responses.
 * Emits fine-grained events for text, tool_calls, and thinking blocks,
 * then terminates with either `done` or `error`.
 */
export type StreamEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; id: string; name: string; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCallContent; partial: AssistantMessage }
  | { type: 'done'; message: AssistantMessage }
  | { type: 'error'; error: string; message?: AssistantMessage };

/** EventStream interface for consuming streaming responses. */
export interface EventStream {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>;
  /** Aggregate to a complete message */
  result(): Promise<AssistantMessage>;
  /** Invoke callback for each event, then return the complete message */
  forEach(cb: (event: StreamEvent) => void): Promise<AssistantMessage>;
}

// ─── Legacy Compatibility Types ──────────────────────────────────────────────

/** Configuration passed to the backward-compatible LLMProvider constructor. */
export interface LLMConfig {
  provider: string;
  apiKey?: string;
  baseURL?: string;
  /** Optional default model override (config file / env / caller) */
  model?: string;
}

/** Per-request completion params (backward compatible). */
export interface CompletionParams {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  extraBody?: Record<string, unknown>;
}

import type { ChatMessage } from '../prompt';

/**
 * Legacy tool call shape (OpenAI function-calling format).
 * agent.ts reads tc.function.name / tc.function.arguments directly.
 */
export interface LegacyToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Unified LLM Provider Interface — the contract agent.ts depends on.
 * Combines the legacy generateResponse() with the new streamResponse().
 */
export interface LLMProviderInterface {
  readonly provider: string;
  /** Non-streaming call (legacy, backward compatible) */
  generateResponse(
    messages: ChatMessage[],
    toolsParam?: Record<string, unknown>[],
    params?: CompletionParams,
  ): Promise<{ content: string; toolCalls: LegacyToolCall[] | null }>;
  /** Streaming call (new interface) */
  streamResponse(
    messages: ChatMessage[],
    toolsParam: Record<string, unknown>[] | undefined,
    onEvent: (event: StreamEvent) => void,
    params?: CompletionParams,
  ): Promise<AssistantMessage>;
}
