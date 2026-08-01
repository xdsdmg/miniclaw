/**
 * LLM Layer — Public Facade (Backward Compatible)
 *
 * Exposes a class-based LLMProvider that wraps the new provider-factory
 * architecture while keeping the legacy `new LLMProvider(config)` interface
 * fully functional.
 */

import type { ChatMessage } from '../prompt';
import { getCustomProviders, loadConfigFile, loadEnvFile, resolveEffectiveConfig } from './config';
import { deepseekProvider } from './providers/deepseek';
import { createOpenAICompatibleProvider } from './providers/custom';
import { getGlobalModels } from './registry';
import type {
  AssistantMessage,
  CompletionParams,
  Context,
  LegacyToolCall,
  LLMConfig,
  LLMProviderInterface,
  Model,
  Provider,
  StreamEvent,
  StreamOptions,
  Tool,
} from './types';

/** Tool definition in the tools-schema format (OpenAI function calling style) */
interface ToolSchemaEntry {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/** Convert tools-schema entries to unified Tool format */
function convertToolSchemas(toolsParam?: Record<string, unknown>[]): Tool[] | undefined {
  if (!toolsParam || toolsParam.length === 0) return undefined;
  return (toolsParam as unknown as ToolSchemaEntry[])
    .filter((t) => t?.function?.name)
    .map((t) => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: (t.function.parameters || {}) as Record<string, unknown>,
    }));
}

/** Extract system prompt from ChatMessage[] */
function extractSystemPrompt(messages: ChatMessage[]): string | undefined {
  const system = messages.find((m) => m.role === 'system');
  return system?.content;
}

/** Convert ChatMessage[] to unified Context messages (excluding system) */
function toContextMessages(messages: ChatMessage[]): Context['messages'] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content };
      }
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          toolCallId: m.tool_call_id || '',
          toolName: '',
          content: m.content,
        };
      }
      // assistant
      const assistant: AssistantMessage = {
        role: 'assistant',
        content: [],
        stopReason: 'stop',
      };
      if (m.content) {
        assistant.content.push({ type: 'text', text: m.content });
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        for (const tc of m.tool_calls) {
          assistant.content.push({
            type: 'toolCall',
            id: tc.id || '',
            name: tc.function?.name || '',
            arguments: safeParseArgs(tc.function?.arguments),
          });
        }
      }
      return assistant;
    });
}

function safeParseArgs(args?: string): Record<string, unknown> {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

/** Extract text + toolCalls from an AssistantMessage, matching legacy response shape */
function toLegacyResponse(result: AssistantMessage): { content: string; toolCalls: LegacyToolCall[] | null } {
  const text = result.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('');
  const toolCalls: LegacyToolCall[] = result.content
    .filter((c) => c.type === 'toolCall')
    .map((c) => {
      const tc = c as { id: string; name: string; arguments: Record<string, unknown> };
      return {
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      };
    });
  return {
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
  };
}

/**
 * Legacy-compatible LLMProvider class.
 *
 * Usage:
 *   const llm = new LLMProvider({ provider: 'deepseek', apiKey: '...' });
 *   const { content, toolCalls } = await llm.generateResponse(messages, tools);
 */
export class LLMProvider implements LLMProviderInterface {
  readonly provider: string;
  private model: Model;
  private config: LLMConfig;
  private modelOverride?: string;

  constructor(config: LLMConfig) {
    // Load .env + miniclaw.json config once
    loadEnvFile();
    loadConfigFile();

    // Resolve effective config: caller args > env > config file
    const effective = resolveEffectiveConfig(config.provider, {
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model,
    });
    this.config = {
      ...config,
      apiKey: effective.apiKey || config.apiKey,
      baseURL: effective.baseURL || config.baseURL,
    };
    this.provider = this.config.provider;
    this.modelOverride = effective.model;

    const models = getGlobalModels();

    // Lazily register built-in + config-file custom providers on first use
    registerBuiltinProviders();

    // Look up the requested provider; if it has no dedicated factory,
    // fall back to a generic OpenAI-compatible provider (keeps backward compat).
    let provider = models.getProvider(this.config.provider);
    if (!provider) {
      provider = createOpenAICompatibleProvider({
        id: this.config.provider,
        name: this.config.provider,
        baseUrl: this.config.baseURL,
        apiKeyEnvVars: [this.config.provider.toUpperCase().replace(/-/g, '_') + '_API_KEY'],
      });
      models.register(provider);
    }

    this.model = this.selectModel(provider);
  }

  /** Select the default model for a provider (model override, else first model) */
  private selectModel(provider: Provider): Model {
    const models = provider.getModels();
    if (models.length === 0) {
      throw new Error(`Provider ${provider.id} has no models`);
    }
    if (this.modelOverride) {
      const match = models.find((m) => m.id === this.modelOverride);
      if (match) return match;
    }
    return models[0];
  }

  /** Build unified Context from legacy messages */
  private buildContext(messages: ChatMessage[], toolsParam?: Record<string, unknown>[]): Context {
    return {
      systemPrompt: extractSystemPrompt(messages),
      messages: toContextMessages(messages),
      tools: convertToolSchemas(toolsParam),
    };
  }

  /** Build StreamOptions from legacy CompletionParams */
  private buildOptions(params?: CompletionParams): StreamOptions {
    const options: StreamOptions = {};
    if (params?.model) options.model = params.model;
    else if (this.modelOverride) options.model = this.modelOverride;
    if (params?.temperature !== undefined) options.temperature = params.temperature;
    if (params?.maxTokens) options.maxTokens = params.maxTokens;
    if (this.config.apiKey) options.apiKey = this.config.apiKey;
    if (this.config.baseURL) options.baseUrl = this.config.baseURL;
    return options;
  }

  /**
   * Legacy non-streaming call.
   */
  async generateResponse(
    messages: ChatMessage[],
    toolsParam?: Record<string, unknown>[],
    params?: CompletionParams,
  ): Promise<{ content: string; toolCalls: LegacyToolCall[] | null }> {
    const context = this.buildContext(messages, toolsParam);
    const options = this.buildOptions(params);
    const result = await getGlobalModels().complete(this.model, context, options);
    return toLegacyResponse(result);
  }

  /**
   * New streaming call — emits events via the callback, returns the final message.
   */
  async streamResponse(
    messages: ChatMessage[],
    toolsParam: Record<string, unknown>[] | undefined,
    onEvent: (event: StreamEvent) => void,
    params?: CompletionParams,
  ): Promise<AssistantMessage> {
    const context = this.buildContext(messages, toolsParam);
    const options = this.buildOptions(params);
    const stream = getGlobalModels().stream(this.model, context, options);
    return stream.forEach(onEvent);
  }
}

// ─── Convenience: built-in models registration ───────────────────────────────

/**
 * Register all built-in providers into the global Models registry.
 * Called automatically on first LLMProvider construction.
 */
export function registerBuiltinProviders(): void {
  const models = getGlobalModels();
  if (!models.getProvider('deepseek')) {
    models.register(deepseekProvider());
  }

  // Register custom OpenAI-compatible providers declared in miniclaw.json
  const customProviders = getCustomProviders();
  if (customProviders) {
    for (const cp of customProviders) {
      if (models.getProvider(cp.id)) continue;
      models.register(
        createOpenAICompatibleProvider({
          id: cp.id,
          name: cp.name ?? cp.id,
          baseUrl: cp.baseURL,
          apiKeyEnvVars: cp.apiKeyEnvVar ? [cp.apiKeyEnvVar] : undefined,
          models: cp.models?.map((m) => ({ id: m })) ?? [],
        }),
      );
    }
  }
}

export * from './types';
export { getGlobalModels, createProvider, logCallStart, logCallComplete, logCallError, logToolFallback } from './registry';
export { deepseekProvider, DEEPSEEK_MODELS } from './providers/deepseek';
