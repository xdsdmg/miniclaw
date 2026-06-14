/**
 * Smart Summarizer
 *
 * Phase 7 Week 4: Intelligent summarization for context compression
 */

import { logger } from '../logger';
import type { ChatMessage } from './compression';

/**
 * Summary Result
 */
export interface SummaryResult {
  /** Summary text */
  summary: string;
  /** Original length */
  originalLength: number;
  /** Summary length */
  summaryLength: number;
  /** Compression ratio */
  compressionRatio: number;
  /** Key points extracted */
  keyPoints?: string[];
}

/**
 * Summary Strategy
 */
export interface SummaryStrategy {
  /** Maximum summary length */
  maxLength: number;
  /** Include key points */
  includeKeyPoints: boolean;
  /** Preserve entities */
  preserveEntities: boolean;
  /** Tone */
  tone: 'concise' | 'detailed' | 'bulleted';
}

/**
 * Default summary strategy
 */
const DEFAULT_STRATEGY: SummaryStrategy = {
  maxLength: 200,
  includeKeyPoints: true,
  preserveEntities: true,
  tone: 'concise',
};

/**
 * Smart Summarizer Class
 * Generates concise summaries for context compression
 */
export class SmartSummarizer {
  private defaultStrategy: SummaryStrategy;

  constructor(strategy?: SummaryStrategy) {
    this.defaultStrategy = strategy || DEFAULT_STRATEGY;
  }

  /**
   * Summarize conversation history
   *
   * Algorithm:
   * 1. Extract user intents and assistant responses
   * 2. Identify tool calls and results
   * 3. Generate chronological summary
   * 4. Extract key decisions
   *
   * @param messages Array of chat messages
   * @param strategy Summary strategy
   * @returns Summary result
   */
  async summarizeHistory(messages: ChatMessage[], strategy?: SummaryStrategy): Promise<string> {
    const config = strategy || this.defaultStrategy;
    logger.debug(`[SmartSummarizer] Summarizing ${messages.length} messages`);

    if (messages.length === 0) {
      return '';
    }

    // Build chronological summary
    const parts: string[] = [];

    // Extract user intents
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      const intents = userMessages.map(m => this.extractIntent(m.content)).filter(Boolean);
      if (intents.length > 0) {
        parts.push(`User requested: ${intents.join(', ')}`);
      }
    }

    // Extract assistant actions
    const assistantMessages = messages.filter(m => m.role === 'assistant');
    if (assistantMessages.length > 0) {
      const actions = assistantMessages.map(m => this.extractActions(m.content)).filter(Boolean);
      if (actions.length > 0) {
        parts.push(`Actions taken: ${actions.join('; ')}`);
      }
    }

    // Extract tool calls
    const toolMessages = messages.filter(m => m.role === 'tool');
    if (toolMessages.length > 0) {
      const tools = toolMessages.map(m => `${m.toolName || 'tool'}: ${this.summarizeToolOutput(m.content)}`);
      parts.push(`Tools used: ${tools.join(', ')}`);
    }

    let summary = parts.join('. ');
    if (summary && !summary.endsWith('.')) {
      summary += '.';
    }

    // Truncate if too long
    if (summary.length > config.maxLength) {
      summary = summary.substring(0, config.maxLength - 3) + '...';
    }

    return summary;
  }

  /**
   * Summarize tool result
   *
   * @param toolName Name of tool that was called
   * @param result Tool output/result
   * @param strategy Summary strategy
   * @returns Summary result
   */
  async summarizeToolResult(toolName: string, result: string, strategy?: SummaryStrategy): Promise<string> {
    const config = strategy || this.defaultStrategy;
    logger.debug(`[SmartSummarizer] Summarizing ${toolName} result (length: ${result.length})`);

    // Extract key information based on tool type
    let summary = '';

    switch (toolName) {
      case 'bash':
        summary = this.summarizeBashResult(result);
        break;
      case 'read':
        summary = this.summarizeReadResult(result);
        break;
      case 'edit':
        summary = this.summarizeEditResult(result);
        break;
      case 'write':
        summary = this.summarizeWriteResult(result);
        break;
      default:
        summary = this.summarizeGeneric(result, config);
    }

    // Truncate if too long
    if (summary.length > config.maxLength) {
      summary = summary.substring(0, config.maxLength - 3) + '...';
    }

    return summary;
  }

  /**
   * Summarize generic text
   *
   * @param text Text to summarize
   * @param strategy Summary strategy
   * @returns Summary
   */
  summarizeGeneric(text: string, strategy?: SummaryStrategy): string {
    const config = strategy || this.defaultStrategy;

    if (!text || text.length === 0) {
      return '';
    }

    // Extract first sentence or key phrase
    const firstSentence = text.split(/[.!?]/)[0];
    let summary = firstSentence.trim();

    // If very short, just return it
    if (text.length <= 50) {
      return text;
    }

    // If longer, extract key information
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      // Return first meaningful line
      const meaningfulLine = lines.find(l =>
        l.length > 10 &&
        !l.startsWith('```') &&
        !l.startsWith('npm') &&
        !l.startsWith('git')
      );
      if (meaningfulLine) {
        summary = meaningfulLine.trim();
      }
    }

    // Truncate if still too long
    if (summary.length > config.maxLength) {
      summary = summary.substring(0, config.maxLength - 3) + '...';
    }

    return summary;
  }

  /**
   * Extract user intent from message
   */
  private extractIntent(content: string): string {
    // Remove common phrases and extract core intent
    const cleaned = content
      .replace(/^(please|can you|could you|help me|I need|I want)\s+/i, '')
      .replace(/^(to|for)\s+/i, '')
      .trim();

    // Extract first 50 chars
    const intent = cleaned.substring(0, 50).trim();

    // Remove trailing incomplete words
    const lastSpace = intent.lastIndexOf(' ');
    if (lastSpace > 20) {
      return intent.substring(0, lastSpace);
    }

    return intent;
  }

  /**
   * Extract actions from assistant response
   */
  private extractActions(content: string): string {
    // Look for action indicators
    const actionPatterns = [
      /(?:created|wrote|edited|read|executed|ran|called|invoked)\s+(?:file|command|tool|function)/i,
      /(?:deployed|built|compiled|tested|generated)\s+(?:application|code|output)/i,
    ];

    for (const pattern of actionPatterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0];
      }
    }

    // If no pattern match, return first meaningful phrase
    return this.extractIntent(content);
  }

  /**
   * Summarize bash tool output
   */
  private summarizeBashResult(result: string): string {
    const lines = result.split('\n').filter(l => l.trim());

    // Look for success/error indicators
    const hasError = lines.some(l =>
      l.includes('error') ||
      l.includes('Error') ||
      l.includes('failed') ||
      l.includes('Failed')
    );

    if (hasError) {
      return 'Command execution completed with errors';
    }

    // Look for success indicators
    if (lines.some(l => l.includes('Done') || l.includes('Success'))) {
      return 'Command executed successfully';
    }

    // Count output lines
    if (lines.length > 10) {
      return `Command produced ${lines.length} lines of output`;
    }

    if (lines.length > 0) {
      return `Command output: ${lines[0].substring(0, 50)}`;
    }

    return 'Command executed';
  }

  /**
   * Summarize read tool output
   */
  private summarizeReadResult(result: string): string {
    const lines = result.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
      return 'Empty file';
    }

    if (lines.length > 50) {
      return `File with ${lines.length} lines`;
    }

    // Return first line with content
    const firstContentLine = lines.find(l => !l.startsWith('//') && !l.startsWith('#') && !l.startsWith('*'));
    if (firstContentLine) {
      return `File: ${firstContentLine.substring(0, 50)}...`;
    }

    return `File with ${lines.length} lines`;
  }

  /**
   * Summarize edit tool output
   */
  private summarizeEditResult(result: string): string {
    if (result.includes('Successfully') || result.includes('success')) {
      return 'File edited successfully';
    }
    if (result.includes('error') || result.includes('Error')) {
      return 'File edit encountered errors';
    }
    return 'File edited';
  }

  /**
   * Summarize write tool output
   */
  private summarizeWriteResult(result: string): string {
    if (result.includes('Successfully') || result.includes('success')) {
      return 'File written successfully';
    }
    if (result.includes('error') || result.includes('Error')) {
      return 'File write encountered errors';
    }
    return 'File written';
  }

  /**
   * Summarize tool output (generic)
   */
  private summarizeToolOutput(result: string): string {
    const lines = result.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
      return 'no output';
    }

    if (lines.length > 5) {
      return `${lines.length} lines of output`;
    }

    return lines[0].substring(0, 30);
  }

  /**
   * Extract key points from text
   *
   * @param text Text to extract from
   * @returns Array of key points
   */
  extractKeyPoints(text: string): string[] {
    const points: string[] = [];

    // Look for bullet points
    const bulletPatterns = [
      /^\s*[-*•]\s+(.+)/gm,
      /^\s*\d+\.\s+(.+)/gm,
    ];

    for (const pattern of bulletPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        points.push(match[1].trim());
      }
    }

    // If no bullets, look for sentences with key indicators
    if (points.length === 0) {
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      const keywords = ['important', 'key', 'critical', 'essential', 'must', 'should'];

      for (const sentence of sentences) {
        const lower = sentence.toLowerCase();
        if (keywords.some(kw => lower.includes(kw))) {
          points.push(sentence.trim());
        }
      }
    }

    return points.slice(0, 5); // Max 5 key points
  }

  /**
   * Generate bulleted summary
   *
   * @param text Text to summarize
   * @returns Bulleted summary
   */
  summarizeBulleted(text: string): string {
    const keyPoints = this.extractKeyPoints(text);

    if (keyPoints.length === 0) {
      return this.summarizeGeneric(text);
    }

    return keyPoints.map(p => `• ${p}`).join('\n');
  }
}
