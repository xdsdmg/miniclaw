/**
 * Context Management
 *
 * Provides types and a builder for composing LLM chat messages from multiple layers:
 *   1. System prompt (general + feature prompts + tool descriptions)
 *   2. Stable sections (appended by afterStableContext hooks, e.g. recent session history)
 *   3. Dynamic sections (appended by afterDynamicContext hooks, e.g. FTS5 results, skills)
 *   4. Conversation history (assistant/user/tool messages)
 *
 * A `Context` object is the carrier threaded through agent execution (Go-style context):
 * hooks and runLoop mutate it in place, and it is only materialized into a ChatMessage[]
 * array — compatible with the OpenAI Chat Completions API — at the LLM call site, via
 * `ContextBuilder.build()`.
 */

import { tools } from './tools-schema';

/**
 * Chat Message Format
 * Compatible with OpenAI Chat Completions API
 */
export interface ChatMessage {
  // system: Instructions that define the AI's identity, behavior rules, and available tool descriptions; typically placed at the start of a conversation
  // user: A message from the user, containing questions or instructions
  // assistant: A response from the AI, containing text content or tool call requests
  // tool: The result of a tool execution, fed back to the AI so it can continue reasoning
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Required when role is 'tool' */
  tool_call_id?: string;
  /** Required when role is 'assistant' and tools were called */
  tool_calls?: any[];
}

/**
 * Context — the carrier threaded through agent execution (Go-style context).
 *
 * Created once per task and mutated in place by hooks and runLoop:
 * - afterStableContext  hooks push sections into `stableSections`
 * - afterDynamicContext hooks push sections into `dynamicSections`
 * - runLoop accumulates the conversation in `history`
 *
 * Only materialized into ChatMessage[] at the LLM call, via `ContextBuilder.build()`.
 */
export interface Context {
  /** System prompt (agent identity, behavior rules) */
  systemPrompt?: string;
  /** Feature-specific instructions, appended after the system prompt */
  featurePrompts: string[];
  /** Tool descriptions for inclusion in the system prompt */
  toolDescriptions: string[];
  /** Sections appended by afterStableContext hooks (e.g. recent session history) */
  stableSections: string[];
  /** Sections appended by afterDynamicContext hooks (e.g. FTS5 results, relevant skills) */
  dynamicSections: string[];
  /** Conversation messages accumulated by runLoop (user/assistant/tool) */
  history: ChatMessage[];
}

/**
 * Default System Prompt
 * Defines the agent's identity and behavior rules.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are Miniclaw, a minimal AI agent. You help users complete tasks by analyzing them, using available tools when needed, and providing clear results.

Rules:
- Think step by step before acting.
- Use tools only when necessary.
- If a tool fails, try a different approach.
- Provide concise, actionable responses.`;

/**
 * Context Builder
 *
 * Materializes a `Context` into a ChatMessage[] array at the LLM call site.
 * Order: system (identity + features + tools + stable + dynamic) -> history.
 *
 * Usage:
 *   const messages = new ContextBuilder(ctx).build();
 */
export class ContextBuilder {
  constructor(private context: Context) {}

  /**
   * Compose the system prompt string from all layers.
   * Sections are joined with double newlines for clear separation.
   */
  getSystemContent(): string {
    const parts: string[] = [];

    if (this.context.systemPrompt) {
      parts.push(this.context.systemPrompt);
    }

    if (this.context.featurePrompts.length) {
      parts.push(...this.context.featurePrompts);
    }

    if (this.context.toolDescriptions.length) {
      const toolSection = 'Available tools:\n' +
        this.context.toolDescriptions.map(d => `- ${d}`).join('\n');
      parts.push(toolSection);
    }

    parts.push(...this.context.stableSections, ...this.context.dynamicSections);

    return parts.join('\n\n');
  }

  /**
   * Materialize the context into ChatMessage[]: [system?, ...history].
   * Call this only at the LLM call site.
   */
  build(): ChatMessage[] {
    const messages: ChatMessage[] = [];

    const systemContent = this.getSystemContent();
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }

    messages.push(...this.context.history);

    return messages;
  }
}

/**
 * Extract human-readable tool descriptions from the tools schema.
 * Each description includes the tool name and its description text.
 */
export function extractToolDescriptions(
  toolsArray: typeof tools
): string[] {
  return toolsArray.map(t => `${t.function.name}: ${t.function.description}`);
}
