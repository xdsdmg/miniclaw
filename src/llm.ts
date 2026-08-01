/**
 * LLM Provider Abstraction Layer
 *
 * Backward-compatible re-export of the new config-driven LLM layer.
 *
 * The real implementation lives in `src/llm/`:
 * - `src/llm/types.ts`           — core types (Provider, Model, Api, Compat)
 * - `src/llm/registry.ts`        — Models collection + createProvider()
 * - `src/llm/providers/`         — provider factories (deepseek, ...)
 * - `src/llm/index.ts`           — public facade (LLMProvider class)
 *
 * Kept at `src/llm.ts` so existing `import { LLMProvider } from './llm'`
 * statements keep working unchanged.
 */

export {
  LLMProvider,
  registerBuiltinProviders,
  getGlobalModels,
  createProvider,
  deepseekProvider,
  DEEPSEEK_MODELS,
} from './llm/index';

export * from './llm/types';
export { logCallStart, logCallComplete, logCallError, logToolFallback } from './llm/registry';
