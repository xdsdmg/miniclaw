/**
 * Context Management
 *
 * Provides types and a builder for composing LLM chat messages from multiple layers:
 *   1. System prompt (general + feature prompts + tool descriptions)
 *   2. Conversation history (assistant/user/tool messages)
 *   3. Current user message
 *
 * The ContextBuilder assembles these layers into a ChatMessage[] array compatible
 * with the OpenAI Chat Completions API.
 */

import { tools } from './tools-schema';

/**
 * Chat Message Format
 * Compatible with OpenAI Chat Completions API
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Required when role is 'tool' */
  tool_call_id?: string;
  /** Required when role is 'assistant' and tools were called */
  tool_calls?: any[];
}

/**
 * Context Builder Configuration
 * All fields are optional except userMessage — the builder assembles only what is provided.
 */
export interface ContextConfig {
  /** System prompt (agent identity, behavior rules) */
  systemPrompt?: string;
  /** Feature-specific instructions, appended after system prompt */
  featurePrompts?: string[];
  /** Tool descriptions for inclusion in system prompt */
  toolDescriptions?: string[];
  /** Existing conversation history */
  history?: ChatMessage[];
  /** The current user message (the task) */
  userMessage: string;
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
 * Assembles a complete ChatMessage[] array from composable pieces:
 *   1. System message (general prompt + feature prompts + tool descriptions)
 *   2. Conversation history (assistant/user/tool messages)
 *   3. Current user message
 *
 * Usage:
 *   const messages = new ContextBuilder({
 *     systemPrompt: DEFAULT_SYSTEM_PROMPT,
 *     featurePrompts: ['Always respond in Chinese.'],
 *     toolDescriptions: extractToolDescriptions(tools),
 *     userMessage: 'List files in current directory',
 *   }).build();
 */
export class ContextBuilder {
  private config: ContextConfig;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Build the complete messages array.
   * Order: system -> history -> user
   */
  build(): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // Layer 1: System prompt (composed from general + feature + tools)
    const systemContent = this.buildSystemPrompt();
    if (systemContent) {
      messages.push({ role: 'system', content: systemContent });
    }

    // Layer 2: Conversation history
    if (this.config.history) {
      messages.push(...this.config.history);
    }

    // Layer 3: Current user message
    messages.push({ role: 'user', content: this.config.userMessage });

    return messages;
  }

  /**
   * Compose the system prompt from optional pieces.
   * Pieces are joined with double newlines for clear separation.
   */
  private buildSystemPrompt(): string {
    const parts: string[] = [];

    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    if (this.config.featurePrompts?.length) {
      parts.push(...this.config.featurePrompts);
    }

    if (this.config.toolDescriptions?.length) {
      const toolSection = 'Available tools:\n' +
        this.config.toolDescriptions.map(d => `- ${d}`).join('\n');
      parts.push(toolSection);
    }

    return parts.join('\n\n');
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
