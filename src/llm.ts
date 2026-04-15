/**
 * LLM Provider Abstraction Layer
 * 
 * Encapsulates interaction with different LLM providers, supporting:
 * - OpenAI (GPT-4, GPT-4o-mini, etc.)
 * - DeepSeek (deepseek-chat)
 * - Kimi (moonshot-v1-8k)
 * - Qwen (qwen-turbo)
 * 
 * Uses OpenAI-compatible SDK for unified interface
 */

import OpenAI from 'openai';
import { tools } from './tools-schema';
import { ChatMessage } from './prompt';

/**
 * LLM Configuration Interface
 */
export interface LLMConfig {
  /** LLM provider name */
  provider: string;
  /** API key (use first, then check environment variables) */
  apiKey?: string;
  /** Custom base URL (for OpenAI-compatible APIs) */
  baseURL?: string;
}

/**
 * LLM Provider Class
 * Encapsulates OpenAI SDK, providing unified LLM calling interface
 * 
 * Supported providers and default base URLs:
 *   openai   - https://api.openai.com/v1
 *   deepseek - https://api.deepseek.com
 *   kimi     - https://api.moonshot.cn/v1
 *   qwen     - https://dashscope.aliyuncs.com/compatible-mode/v1
 */
export class LLMProvider {
  private client: OpenAI;
  private config: LLMConfig;

  /**
   * Constructor
   * Initialize OpenAI client based on configuration, set appropriate base URL
   * 
   * @param config LLM configuration
   */
  constructor(config: LLMConfig) {
    this.config = config;

    let baseURL = config.baseURL;

    if (!baseURL) {
      switch (config.provider.toLowerCase()) {
        case 'deepseek':
          baseURL = 'https://api.deepseek.com';
          break;
        case 'kimi':
          baseURL = 'https://api.moonshot.cn/v1';
          break;
        case 'qwen':
          baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
          break;
        case 'openai':
        default:
          baseURL = 'https://api.openai.com/v1';
          break;
      }
    }

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || 'dummy-key',
      baseURL: baseURL,
    });
  }

  /**
   * Generate LLM response
   *
   * @param messages         Chat messages array (system, user, assistant, tool)
   * @param toolsParam       Optional tool definitions array
   * @param attemptFallback  Whether to retry when tools not supported (default: true)
   * @returns Response object containing content or tool calls
   */
  async generateResponse(
    messages: ChatMessage[],
    toolsParam?: typeof tools,
    attemptFallback: boolean = true
  ): Promise<{ content: string; toolCalls: any[] | null }> {
    try {
      const completion = await this.client.chat.completions.create({
        messages: messages as any,
        model: this.getModelName(),
        temperature: 0.7,
        tools: toolsParam,
      });

      const message = completion.choices[0]?.message;
      return {
        content: message.content || "",
        toolCalls: message.tool_calls || null
      };
    } catch (error) {
      if (attemptFallback && toolsParam && this.isToolsNotSupportedError(error)) {
        console.warn("Model does not support tools, retrying without tools...");
        return this.generateResponse(messages, undefined, false);
      }
      throw error;
    }
  }

  private isToolsNotSupportedError(error: any): boolean {
    const errorMessage = (error?.message || "").toLowerCase();
    return errorMessage.includes("tools") ||
      errorMessage.includes("function") ||
      errorMessage.includes("not supported") ||
      errorMessage.includes("invalid parameter");
  }

  /**
   * Get model name for current provider
   * Support overriding default models via environment variables:
   *   OPENAI_MODEL, DEEPSEEK_MODEL, KIMI_MODEL, QWEN_MODEL
   * 
   * @returns Model name string
   */
  private getModelName(): string {
    switch (this.config.provider.toLowerCase()) {
      case 'deepseek':
        return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      case 'kimi':
        return process.env.KIMI_MODEL || 'moonshot-v1-8k';
      case 'qwen':
        return process.env.QWEN_MODEL || 'qwen-turbo';
      case 'openai':
      default:
        return process.env.OPENAI_MODEL || 'gpt-4o-mini';
    }
  }
}
