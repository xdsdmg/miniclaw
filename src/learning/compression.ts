/**
 * Context Compression
 *
 * Phase 7 Week 4: Context compression to stay within token limits
 */

import { logger } from '../logger';
import { SmartSummarizer } from './summarizer';

/**
 * Chat Message Interface
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: Date;
  toolCallId?: string;
  toolName?: string;
}

/**
 * Compression Strategy
 */
export interface CompressionStrategy {
  /** Maximum tokens to preserve */
  maxTokens: number;
  /** Sections to preserve (by role/type) */
  preserveSections: {
    /** Preserve current task (last user message) */
    currentTask: boolean;
    /** Preserve last N assistant responses */
    lastAssistantResponses: number;
    /** Preserve skills with success rate >= threshold */
    minSkillSuccessRate: number;
    /** Preserve tool results */
    toolResults: boolean;
  };
  /** Target compression ratio (0-1) */
  compressionRatio: number;
}

/**
 * Compression Result
 */
export interface CompressionResult {
  /** Compressed context */
  context: string;
  /** Original token count estimate */
  originalTokens: number;
  /** Compressed token count estimate */
  compressedTokens: number;
  /** Sections removed */
  removedSections: string[];
  /** Sections summarized */
  summarizedSections: string[];
}

/**
 * Context Section
 */
interface ContextSection {
  id: string;
  type: 'system' | 'user' | 'assistant' | 'tool' | 'skill';
  content: string;
  priority: number; // Higher = more important to preserve
  metadata?: {
    successRate?: number;
    toolName?: string;
    timestamp?: Date;
  };
}

/**
 * Default compression strategy
 */
const DEFAULT_STRATEGY: CompressionStrategy = {
  maxTokens: 8000,
  preserveSections: {
    currentTask: true,
    lastAssistantResponses: 2,
    minSkillSuccessRate: 0.7,
    toolResults: false, // Summarize tool results by default
  },
  compressionRatio: 0.5,
};

/**
 * Context Compressor Class
 * Compresses conversation context to stay within token limits
 */
export class ContextCompressor {
  private summarizer: SmartSummarizer;
  private defaultStrategy: CompressionStrategy;

  constructor(summarizer?: SmartSummarizer, strategy?: CompressionStrategy) {
    this.summarizer = summarizer || new SmartSummarizer();
    this.defaultStrategy = strategy || DEFAULT_STRATEGY;
  }

  /**
   * Compress context using strategy
   *
   * Compression Algorithm:
   * 1. Parse context into sections
   * 2. Score sections by importance
   * 3. Preserve high-priority sections
   * 4. Summarize medium-priority sections
   * 5. Remove low-priority sections
   *
   * @param context Full conversation context
   * @param strategy Compression strategy (uses default if not provided)
   * @returns Compression result
   */
  async compress(context: string, strategy?: CompressionStrategy): Promise<CompressionResult> {
    const config = strategy || this.defaultStrategy;
    logger.debug(`[ContextCompressor] Compressing context (target: ${config.maxTokens} tokens)`);

    // Handle empty context
    if (!context || context.trim().length === 0) {
      return {
        context: '',
        originalTokens: 0,
        compressedTokens: 0,
        removedSections: [],
        summarizedSections: [],
      };
    }

    // Parse context into sections
    const sections = this.parseContext(context);
    const originalTokens = this.estimateTokens(context);

    // Separate into preserve, summarize, and remove
    const { preserve, summarize, remove } = this.categorizeSections(sections, config);

    // Build compressed context
    const compressedParts: string[] = [];
    const removedSections: string[] = [];
    const summarizedSections: string[] = [];

    // Add preserved sections
    for (const section of preserve) {
      compressedParts.push(this.formatSection(section));
    }

    // Summarize sections
    for (const section of summarize) {
      const summary = await this.summarizeSection(section);
      if (summary) {
        compressedParts.push(`[Summary: ${section.type}]\n${summary}`);
        summarizedSections.push(section.id);
      } else {
        removedSections.push(section.id);
      }
    }

    // Track removed sections
    for (const section of remove) {
      removedSections.push(section.id);
    }

    const compressedContext = compressedParts.join('\n\n');
    const compressedTokens = this.estimateTokens(compressedContext);

    logger.debug(`[ContextCompressor] Compressed ${originalTokens} -> ${compressedTokens} tokens`);

    return {
      context: compressedContext,
      originalTokens,
      compressedTokens,
      removedSections,
      summarizedSections,
    };
  }

  /**
   * Parse context into sections
   */
  private parseContext(context: string): ContextSection[] {
    const sections: ContextSection[] = [];
    const lines = context.split('\n');
    let currentSection: Partial<ContextSection> = {};
    let sectionId = 0;

    for (const line of lines) {
      // Detect section headers
      if (line.startsWith('## ')) {
        // Save previous section
        if (currentSection.content) {
          sections.push({
            id: `section-${sectionId++}`,
            type: this.inferSectionType(line),
            content: currentSection.content,
            priority: 5,
          } as ContextSection);
        }

        // Start new section
        currentSection = {
          content: '',
        };

        // Set type based on header
        if (line.includes('Skills')) {
          currentSection.type = 'skill';
        } else if (line.includes('Tool')) {
          currentSection.type = 'tool';
        } else if (line.includes('Assistant')) {
          currentSection.type = 'assistant';
        } else if (line.includes('User')) {
          currentSection.type = 'user';
        } else {
          currentSection.type = 'system';
        }
      } else {
        currentSection.content = (currentSection.content || '') + line + '\n';
      }
    }

    // Add last section
    if (currentSection.content) {
      sections.push({
        id: `section-${sectionId}`,
        type: (currentSection.type as any) || 'system',
        content: currentSection.content,
        priority: 5,
      } as ContextSection);
    }

    return sections;
  }

  /**
   * Infer section type from header text
   */
  private inferSectionType(header: string): 'system' | 'user' | 'assistant' | 'tool' | 'skill' {
    const lower = header.toLowerCase();
    if (lower.includes('skill')) return 'skill';
    if (lower.includes('tool')) return 'tool';
    if (lower.includes('assistant')) return 'assistant';
    if (lower.includes('user')) return 'user';
    return 'system';
  }

  /**
   * Categorize sections by priority
   */
  private categorizeSections(
    sections: ContextSection[],
    strategy: CompressionStrategy
  ): { preserve: ContextSection[]; summarize: ContextSection[]; remove: ContextSection[] } {
    const preserve: ContextSection[] = [];
    const summarize: ContextSection[] = [];
    const remove: ContextSection[] = [];

    // Sort sections by priority
    const sorted = [...sections].sort((a, b) => b.priority - a.priority);

    for (const section of sorted) {
      let shouldPreserve = false;
      let shouldSummarize = false;

      // Check preservation rules
      if (section.type === 'skill' && section.metadata?.successRate) {
        if (section.metadata.successRate >= strategy.preserveSections.minSkillSuccessRate) {
          shouldPreserve = true;
        } else if (section.metadata.successRate >= 0.5) {
          shouldSummarize = true;
        }
      }

      if (section.type === 'user' && strategy.preserveSections.currentTask) {
        // Preserve last user message (current task)
        shouldPreserve = true;
      }

      if (section.type === 'assistant') {
        // Preserve last N assistant responses
        const assistantCount = sorted.filter(s => s.type === 'assistant').indexOf(section);
        if (assistantCount < strategy.preserveSections.lastAssistantResponses) {
          shouldPreserve = true;
        } else {
          shouldSummarize = true;
        }
      }

      if (section.type === 'tool' && !strategy.preserveSections.toolResults) {
        shouldSummarize = true;
      }

      // Default: summarize medium priority, remove low priority
      if (!shouldPreserve && !shouldSummarize) {
        if (section.priority >= 5) {
          shouldSummarize = true;
        } else {
          // Low priority - will be removed
        }
      }

      if (shouldPreserve) {
        preserve.push(section);
      } else if (shouldSummarize) {
        summarize.push(section);
      } else {
        remove.push(section);
      }
    }

    return { preserve, summarize, remove };
  }

  /**
   * Summarize a section
   */
  private async summarizeSection(section: ContextSection): Promise<string | null> {
    try {
      if (section.type === 'tool') {
        return await this.summarizer.summarizeToolResult(
          section.metadata?.toolName || 'unknown',
          section.content
        );
      } else if (section.type === 'assistant') {
        return await this.summarizer.summarizeHistory([
          { role: 'assistant', content: section.content, timestamp: section.metadata?.timestamp },
        ]);
      } else {
        // Generic summarization
        return this.summarizer.summarizeGeneric(section.content);
      }
    } catch (error) {
      logger.warn(`[ContextCompressor] Failed to summarize section ${section.id}: ${error}`);
      return null;
    }
  }

  /**
   * Format section for output
   */
  private formatSection(section: ContextSection): string {
    if (section.type === 'skill') {
      return `## ${section.content.split('\n')[0] || 'Skill'}\n${section.content}`;
    }
    return section.content;
  }

  /**
   * Estimate token count (rough approximation: ~4 chars per token)
   */
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token for English text
    // This is a simplified approximation
    return Math.ceil(text.length / 4);
  }

  /**
   * Compress messages array
   */
  async compressMessages(messages: ChatMessage[], strategy?: CompressionStrategy): Promise<ChatMessage[]> {
    const config = strategy || this.defaultStrategy;

    // Preserve last user message (current task)
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const result: ChatMessage[] = lastUserMsg ? [lastUserMsg] : [];

    // Preserve last N assistant responses
    const assistantMsgs = messages.filter(m => m.role === 'assistant');
    const preservedAssistants = assistantMsgs.slice(-config.preserveSections.lastAssistantResponses);
    result.push(...preservedAssistants);

    // Preserve system messages
    const systemMsgs = messages.filter(m => m.role === 'system');
    result.push(...systemMsgs);

    return result;
  }

  /**
   * Check if context needs compression
   */
  needsCompression(context: string, strategy?: CompressionStrategy): boolean {
    const config = strategy || this.defaultStrategy;
    const estimatedTokens = this.estimateTokens(context);
    return estimatedTokens > config.maxTokens * (1 - config.compressionRatio);
  }
}
