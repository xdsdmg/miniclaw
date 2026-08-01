/**
 * LLM Layer — Generic OpenAI-Compatible Provider Factory
 *
 * Creates a Provider for any OpenAI-compatible API (OpenAI, Kimi, Qwen,
 * OpenRouter, custom endpoints, etc.) without a dedicated factory.
 *
 * Used as a graceful fallback in the LLMProvider facade when a provider id
 * has no registered factory. This keeps backward compatibility: existing
 * code that constructs `new Agent({ provider: 'openai', ... })` keeps working,
 * while dedicated factories (deepseek, ...) remain the preferred path.
 */

import { createProvider } from '../registry';
import { openAICompletionsApi } from '../streams/openai-completions';
import type { Model, OpenAICompletionsCompat, Provider } from '../types';

export interface OpenAICompatibleProviderOptions {
  /** Provider id, e.g. "openai", "kimi", "qwen" */
  id: string;
  /** Display name. Default: id */
  name?: string;
  /** Base URL for the OpenAI-compatible API */
  baseUrl?: string;
  /** Env var(s) that hold the API key. Default: `<PROVIDER>_API_KEY` and LLM_API_KEY */
  apiKeyEnvVars?: string[];
  /** Models exposed by this provider */
  models?: Array<{
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    capabilities?: Model['capabilities'];
    compat?: OpenAICompletionsCompat;
  }>;
}

/** Derive a conventional env var name from a provider id, e.g. "my-api" → "MY_API_API_KEY" */
function defaultEnvVar(providerId: string): string {
  return `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/**
 * Create a generic OpenAI-compatible provider factory.
 *
 * If no models are provided, a minimal default model is created so the
 * provider always exposes at least one usable model.
 */
export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): Provider<'openai-completions'> {
  // Default to the OpenAI endpoint, matching legacy behavior where unknown
  // providers were routed to api.openai.com/v1.
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
  const apiKeyEnvVars = options.apiKeyEnvVars ?? [defaultEnvVar(options.id)];

  const models: Array<Model<'openai-completions'>> = (options.models ?? []).map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    api: 'openai-completions',
    provider: options.id,
    baseUrl: baseUrl ?? '',
    capabilities: m.capabilities ?? { tools: true, streaming: true, thinking: false },
    compat: m.compat,
    contextWindow: m.contextWindow ?? 128000,
    maxTokens: m.maxTokens ?? 8192,
  }));

  // Always expose at least one model so the provider is usable
  if (models.length === 0) {
    models.push({
      id: `${options.id}-model`,
      name: `${options.name ?? options.id} Model`,
      api: 'openai-completions',
      provider: options.id,
      baseUrl: baseUrl ?? '',
      capabilities: { tools: true, streaming: true, thinking: false },
      contextWindow: 128000,
      maxTokens: 8192,
    });
  }

  return createProvider<'openai-completions'>({
    id: options.id,
    name: options.name ?? options.id,
    baseUrl,
    auth: {
      apiKeyEnvVars,
      isConfigured() {
        return (
          apiKeyEnvVars.some((v) => !!process.env[v]) ||
          !!process.env.LLM_API_KEY
        );
      },
    },
    models,
    api: openAICompletionsApi(),
  });
}
