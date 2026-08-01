/**
 * LLM Layer — DeepSeek Provider
 *
 * Provider factory for DeepSeek. Uses the openai-completions API protocol.
 */

import { createProvider } from '../registry';
import { openAICompletionsApi } from '../streams/openai-completions';
import type { Provider } from '../types';

/** DeepSeek model list */
export const DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    api: 'openai-completions' as const,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    capabilities: {
      tools: true,
      streaming: true,
      thinking: true,
    },
    compat: {
      thinkingFormat: 'deepseek' as const,
      supportsReasoningEffort: false,
      supportsSystemRole: true,
      supportsStrictTools: false,
      supportsUsageInStreaming: true,
    },
    contextWindow: 65536,
    maxTokens: 8192,
  },
];

/**
 * Create the DeepSeek provider factory.
 * Returns a Provider using the OpenAI Chat Completions protocol.
 */
export function deepseekProvider(): Provider<'openai-completions'> {
  return createProvider<'openai-completions'>({
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    auth: {
      apiKeyEnvVars: ['DEEPSEEK_API_KEY'],
      isConfigured() {
        return !!process.env.DEEPSEEK_API_KEY || !!process.env.LLM_API_KEY;
      },
    },
    models: DEEPSEEK_MODELS,
    api: openAICompletionsApi(),
  });
}
