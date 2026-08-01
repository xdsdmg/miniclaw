/**
 * LLM Layer — Provider Registry
 *
 * Manages provider registration and provides a unified call entry point.
 * Inspired by pi's Models collection:
 * - register(): register a provider factory
 * - getModel()/getModels(): query models
 * - getAvailableModels(): only return models whose provider is configured
 * - stream()/complete(): unified I/O entry
 *
 * Also integrates LLM call logging via src/logger.ts:
 * every call records request info, token usage (incl. KV cache hits), and duration.
 */

import { logger } from '../logger';
import type {
  Api,
  AssistantMessage,
  Context,
  EventStream,
  Model,
  Provider,
  ProviderAuth,
  StreamEvent,
  StreamOptions,
} from './types';

// ─── Models Interface ────────────────────────────────────────────────────────

export interface Models {
  /** Register a provider */
  register(provider: Provider): void;
  /** Get all registered providers */
  getProviders(): readonly Provider[];
  /** Get a provider by id */
  getProvider(id: string): Provider | undefined;
  /** Get all models (optionally filtered by provider) */
  getModels(provider?: string): readonly Model[];
  /** Look up a specific model */
  getModel(provider: string, modelId: string): Model | undefined;
  /** Only return models whose provider auth is configured */
  getAvailableModels(): Promise<readonly Model[]>;
  /** Unified streaming call */
  stream(model: Model, context: Context, options?: StreamOptions): EventStream;
  /** Unified non-streaming call (stream + aggregate) */
  complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage>;
}

// ─── Logging Helpers ─────────────────────────────────────────────────────────

/** Generate a short unique request id */
function generateRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `llm_req_${rand}`;
}

/** Summarize a context for the request log */
function summarizeContext(context: Context): Array<{ role: string; length: string | number }> {
  return (context.messages || []).map((m) => ({
    role: m.role,
    length: typeof m.content === 'string' ? m.content.length : `${m.content.length} blocks`,
  }));
}

/** Preview the text content of a message (first N chars) */
function extractTextPreview(content: AssistantMessage['content'], maxLen = 200): string {
  const text = content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('');
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

/** Extract tool calls from a message */
function extractToolCalls(content: AssistantMessage['content']): Array<{ name: string }> {
  return content
    .filter((c) => c.type === 'toolCall')
    .map((c) => ({ name: (c as { name: string }).name }));
}

/** Map internal Usage to log shape */
function formatUsage(usage: AssistantMessage['usage']): Record<string, unknown> | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.input,
    completionTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning,
    totalTokens: usage.totalTokens,
  };
}

/** 1. Log call start — returns requestId */
export function logCallStart(model: Model, context: Context, options?: StreamOptions): string {
  const requestId = generateRequestId();
  logger.info('[LLM] Call started', {
    requestId,
    provider: model.provider,
    model: model.id,
    messages: summarizeContext(context),
    toolCount: context.tools?.length ?? 0,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
  });
  return requestId;
}

/** 2. Log call complete */
export function logCallComplete(
  requestId: string,
  result: AssistantMessage,
  durationMs: number,
  extra?: { isStreaming?: boolean; isRetry?: boolean; retryCount?: number },
): void {
  logger.info('[LLM] Call completed', {
    requestId,
    durationMs,
    ...extra,
    usage: formatUsage(result.usage),
    stopReason: result.stopReason,
    contentPreview: extractTextPreview(result.content),
    toolCalls: extractToolCalls(result.content),
  });
}

/** 3. Log call error */
export function logCallError(requestId: string, error: Error, durationMs: number): void {
  logger.error('[LLM] Call failed', {
    requestId,
    durationMs,
    error: error.message,
    stack: error.stack,
  });
}

/** 4. Log tool fallback (retrying without tools) */
export function logToolFallback(requestId: string, model: string): void {
  logger.warn('[LLM] Tool fallback', {
    requestId,
    model,
    message: 'Model does not support tools, retrying without tools',
  });
}

// ─── Models Implementation ───────────────────────────────────────────────────

class ModelsImpl implements Models {
  private providers = new Map<string, Provider>();

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getModels(provider?: string): readonly Model[] {
    if (provider !== undefined) {
      return this.providers.get(provider)?.getModels() ?? [];
    }
    const models: Model[] = [];
    for (const p of this.providers.values()) {
      try {
        models.push(...p.getModels());
      } catch {
        // Best-effort: ill-behaved providers yield no models
      }
    }
    return models;
  }

  getModel(provider: string, modelId: string): Model | undefined {
    return this.getModels(provider).find((m) => m.id === modelId);
  }

  async getAvailableModels(): Promise<readonly Model[]> {
    const available: Model[] = [];
    for (const provider of this.providers.values()) {
      if (provider.auth.isConfigured()) {
        try {
          available.push(...provider.getModels());
        } catch {
          // skip
        }
      }
    }
    return available;
  }

  stream(model: Model, context: Context, options?: StreamOptions): EventStream {
    const provider = this.providers.get(model.provider);
    if (!provider) {
      throw new Error(`Unknown provider: ${model.provider}`);
    }
    return provider.stream(model as never, context, options);
  }

  async complete(model: Model, context: Context, options?: StreamOptions): Promise<AssistantMessage> {
    const requestId = logCallStart(model, context, options);
    const startTime = Date.now();

    try {
      const result = await this.stream(model, context, options).result();
      logCallComplete(requestId, result, Date.now() - startTime, { isStreaming: false });
      return result;
    } catch (error) {
      logCallError(requestId, error as Error, Date.now() - startTime);
      throw error;
    }
  }
}

// ─── Global Models Instance ──────────────────────────────────────────────────

let globalModels: ModelsImpl | undefined;

/**
 * Get the global Models instance (lazily created).
 */
export function getGlobalModels(): Models {
  if (!globalModels) {
    globalModels = new ModelsImpl();
  }
  return globalModels;
}

// ─── createProvider Factory ──────────────────────────────────────────────────

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  /** Display name. Default: id */
  name?: string;
  baseUrl?: string;
  /** Required — every provider has auth semantics */
  auth: ProviderAuth;
  /** Static model list */
  models: readonly Model<TApi>[];
  /** Stream implementation */
  api: ProviderStreams;
}

/** Contract for an API protocol stream implementation module */
export interface ProviderStreams {
  stream(model: Model, context: Context, options?: StreamOptions): EventStream;
}

/**
 * Build a Provider from parts. All built-in provider factories go through this,
 * keeping a single construction path.
 */
export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  const provider: Provider<TApi> = {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    auth: input.auth,
    getModels: () => input.models,
    stream: (model, context, options) =>
      input.api.stream(model as unknown as Model, context, options),
    async complete(model, context, options): Promise<AssistantMessage> {
      return this.stream(model, context, options).result();
    },
  };
  return provider;
}

// ─── Helper: is a provider configured (for env-api-keys discovery) ───────────

export function providerIsConfigured(provider: Provider): boolean {
  try {
    return provider.auth.isConfigured();
  } catch {
    return false;
  }
}

export { StreamEvent };
export type { AssistantMessage };
