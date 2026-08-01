/**
 * LLM Layer — OpenAI Chat Completions Stream Implementation
 *
 * Implements the "openai-completions" API protocol using the openai SDK.
 * Used by all OpenAI-compatible providers (DeepSeek, Kimi, Qwen, custom).
 *
 * Handles:
 * - Message/tool format conversion (unified ↔ OpenAI)
 * - Streaming and non-streaming responses
 * - Token usage extraction incl. KV cache (cached_tokens)
 * - Reasoning/thinking content (deepseek_reasoning_content)
 */

import OpenAI from 'openai';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import { createEventStream } from '../event-stream';
import { logToolFallback } from '../registry';
import type {
  AssistantMessage,
  ContentBlock,
  Context,
  EventStream,
  Message,
  Model,
  OpenAICompletionsCompat,
  StreamEvent,
  StreamOptions,
  Tool,
  Usage,
} from '../types';

/** Narrow the model compat to the openai-completions variant */
function getCompat(model: Model): OpenAICompletionsCompat | undefined {
  const compat = model.compat as OpenAICompletionsCompat | undefined;
  // If this is actually an AnthropicMessagesCompat, discard it (stream layer is openai)
  if (compat && 'supportsEagerToolInputStreaming' in compat) return undefined;
  return compat;
}

// ─── Format Conversion ────────────────────────────────────────────────────────

/** Convert unified tools to OpenAI ChatCompletionTool format */
function convertTools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as Record<string, unknown>,
    },
  }));
}

/** Convert unified messages to OpenAI chat message format */
function convertMessages(messages: Message[], systemPrompt?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  for (const message of messages) {
    switch (message.role) {
      case 'user': {
        const content = typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((c) => c.type === 'text')
              .map((c) => (c as { text: string }).text)
              .join('');
        result.push({ role: 'user', content });
        break;
      }
      case 'assistant': {
        const text = message.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { text: string }).text)
          .join('') || undefined;
        const toolCalls = message.content
          .filter((c) => c.type === 'toolCall')
          .map((c) => {
            const tc = c as { id: string; name: string; arguments: Record<string, unknown> };
            return {
              id: tc.id,
              type: 'function' as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            };
          });
        result.push({
          role: 'assistant',
          content: text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
        break;
      }
      case 'tool': {
        const text = typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((c) => c.type === 'text')
              .map((c) => (c as { text: string }).text)
              .join('');
        result.push({
          role: 'tool',
          tool_call_id: message.toolCallId,
          content: text,
        });
        break;
      }
    }
  }

  return result;
}

/** Build a Usage object from OpenAI usage, extracting KV cache hit + reasoning tokens */
function extractUsage(usage?: OpenAI.Completions.CompletionUsage): Usage | undefined {
  if (!usage) return undefined;
  const raw = usage as unknown as {
    prompt_tokens_details?: { cached_tokens?: number };
    // DeepSeek reports cache as prompt_cache_hit_tokens / prompt_cache_miss_tokens
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  // Prefer standard OpenAI cached_tokens; fall back to DeepSeek's prompt_cache_hit_tokens
  const cacheRead = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens ?? 0;
  return {
    input: usage.prompt_tokens,
    output: usage.completion_tokens,
    cacheRead,
    cacheWrite: 0,
    reasoning: raw.completion_tokens_details?.reasoning_tokens,
    totalTokens: usage.total_tokens,
  };
}

/** Build partial AssistantMessage from raw content blocks */
function buildPartial(model: Model, blocks: ContentBlock[]): AssistantMessage {
  return {
    role: 'assistant',
    content: blocks,
    api: model.api,
    provider: model.provider,
    model: model.id,
  };
}

// ─── Streaming Implementation ────────────────────────────────────────────────

/**
 * Stream a response from an OpenAI-compatible Chat Completions API.
 */
export function openAICompletionsApi() {
  return {
    stream(model: Model, context: Context, options?: StreamOptions): EventStream {
      const client = new OpenAI({
        apiKey: options?.apiKey || process.env[`${model.provider.toUpperCase().replace(/-/g, '_')}_API_KEY`] || process.env.LLM_API_KEY || 'dummy-key',
        baseURL: options?.baseUrl || model.baseUrl,
        timeout: options?.timeoutMs,
        maxRetries: options?.maxRetries ?? 2,
      });

      const messages = convertMessages(context.messages, context.systemPrompt);
      const tools = context.tools && context.tools.length > 0
        ? convertTools(context.tools)
        : undefined;

      const compat = getCompat(model);

      // Build the request body as a plain object (compat-driven shaping is easier)
      const requestBody: Record<string, unknown> = {
        model: options?.model || model.id,
        messages,
        temperature: options?.temperature ?? 0.7,
        ...(tools ? { tools } : {}),
      };

      // Compat-driven request shaping
      if (compat) {
        if (compat.thinkingFormat === 'deepseek') {
          // DeepSeek: max_tokens field, reasoning_effort not supported
          requestBody.max_tokens = options?.maxTokens ?? model.maxTokens;
        } else {
          requestBody[compat.maxTokensField ?? 'max_tokens'] = options?.maxTokens ?? model.maxTokens;
        }
      } else {
        requestBody.max_tokens = options?.maxTokens ?? model.maxTokens;
      }

      // Request usage in streaming when the compat supports it (DeepSeek does)
      if (compat?.supportsUsageInStreaming ?? true) {
        requestBody.stream_options = { include_usage: true };
      }

      // Allow request interception
      const finalBody = options?.onPayload
        ? (options.onPayload(requestBody) ?? requestBody)
        : requestBody;

      const requestId = `llm_req_${Math.random().toString(36).slice(2, 8)}`;

      async function* generate(): AsyncGenerator<StreamEvent> {
        let blocks: ContentBlock[] = [];
        let usage: Usage | undefined;
        let stopReason: AssistantMessage['stopReason'] = 'stop';
        let errorMessage: string | undefined;

        // Track tool call being assembled
        let currentToolCall: { id: string; name: string; args: string } | undefined;

        try {
          yield { type: 'start', partial: buildPartial(model, blocks) };

          const stream = await client.chat.completions.create(
            { ...finalBody, stream: true } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
          );

          for await (const chunk of stream) {
            // Capture usage from the final chunk (when include_usage is set)
            if (chunk.usage) {
              usage = extractUsage(chunk.usage);
            }

            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            // Text content
            if (delta.content) {
              const last = blocks[blocks.length - 1];
              if (last && last.type === 'text') {
                (last as { text: string }).text += delta.content;
              } else {
                blocks.push({ type: 'text', text: delta.content });
              }
              yield { type: 'text_delta', contentIndex: blocks.length - 1, delta: delta.content, partial: buildPartial(model, blocks) };
            }

            // Reasoning content (DeepSeek)
            const reasoningContent = (delta as unknown as { reasoning_content?: string }).reasoning_content;
            if (reasoningContent) {
              const last = blocks[blocks.length - 1];
              if (last && last.type === 'thinking') {
                (last as { thinking: string }).thinking += reasoningContent;
              } else {
                blocks.push({ type: 'thinking', thinking: reasoningContent });
              }
              yield { type: 'thinking_delta', contentIndex: blocks.length - 1, delta: reasoningContent, partial: buildPartial(model, blocks) };
            }

            // Tool calls
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  if (currentToolCall && currentToolCall.id !== tc.id) {
                    // flush previous
                    const name = currentToolCall.name;
                    if (name) {
                      blocks.push({ type: 'toolCall', id: currentToolCall.id, name, arguments: safeParseArgs(currentToolCall.args) });
                      yield { type: 'toolcall_end', contentIndex: blocks.length - 1, toolCall: blocks[blocks.length - 1] as { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }, partial: buildPartial(model, blocks) };
                    }
                  }
                  currentToolCall = { id: tc.id, name: tc.function?.name ?? '', args: tc.function?.arguments ?? '' };
                  if (tc.function?.name) {
                    yield { type: 'toolcall_start', contentIndex: blocks.length - 1, id: tc.id, name: tc.function.name, partial: buildPartial(model, blocks) };
                  }
                }
                if (currentToolCall && tc.function?.arguments) {
                  currentToolCall.args += tc.function.arguments;
                  yield { type: 'toolcall_delta', contentIndex: blocks.length - 1, delta: tc.function.arguments, partial: buildPartial(model, blocks) };
                }
              }
            }

            // Finish reason
            if (chunk.choices[0]?.finish_reason) {
              const fr = chunk.choices[0].finish_reason;
              stopReason = fr === 'tool_calls' ? 'toolUse' : fr === 'length' ? 'length' : 'stop';
            }
          }

          // Flush any pending tool call
          if (currentToolCall && currentToolCall.name) {
            blocks.push({ type: 'toolCall', id: currentToolCall.id, name: currentToolCall.name, arguments: safeParseArgs(currentToolCall.args) });
            yield { type: 'toolcall_end', contentIndex: blocks.length - 1, toolCall: blocks[blocks.length - 1] as { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }, partial: buildPartial(model, blocks) };
          }

          // Usage (may be unavailable in streaming without include_usage)
          // Try to get usage from the last chunk if available
          // (we don't have direct access here, so use whatever was set)

          const finalMessage: AssistantMessage = {
            role: 'assistant',
            content: blocks,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage,
            stopReason,
            errorMessage,
          };

          yield { type: 'done', message: finalMessage };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          // Tool fallback: retry without tools
          if (tools && isToolsNotSupportedError(error)) {
            logToolFallback(requestId, model.id);
            const noToolsContext = { ...context, tools: undefined };
            const fallbackStream = openAICompletionsApi().stream(model, noToolsContext, options);
            for await (const ev of fallbackStream) {
              yield ev;
            }
            return;
          }
          errorMessage = errMsg;
          yield {
            type: 'error',
            error: errMsg,
            message: buildPartial(model, blocks),
          };
        }
      }

      return createEventStream(generate());
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args || '{}');
  } catch {
    return {};
  }
}

function isToolsNotSupportedError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('tools') ||
    message.includes('function') ||
    message.includes('not supported') ||
    message.includes('invalid parameter')
  );
}
