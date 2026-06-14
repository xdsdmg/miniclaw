/**
 * Knowledge Extractor
 *
 * Extracts structured knowledge from successful conversations.
 * Uses LLM-based semantic analysis to identify skills, patterns, and facts.
 */

import { LLMProvider } from '../llm';
import { LearningStorage, LearnedSkill, ToolStep } from './storage';
import { MemoryStorage, ToolExecution as MemoryToolExecution } from '../memory/storage';
import { logger } from '../logger';
import { randomUUID } from 'crypto';

/**
 * Extracted Knowledge
 * Knowledge extracted from a conversation
 */
export interface ExtractedKnowledge {
  /** Knowledge type */
  type: 'skill' | 'pattern' | 'fact';
  /** Knowledge title */
  title: string;
  /** Knowledge description */
  description: string;
  /** Task pattern for matching */
  taskPattern: string;
  /** Tool execution sequence */
  toolSequence: ToolStep[];
  /** Expected outcome */
  outcome: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Extraction metadata */
  metadata: {
    /** Source conversation ID */
    learnedFrom: string;
    /** When it was extracted */
    learnedAt: Date;
    /** User ID */
    userId: string;
  };
}

/**
 * Extraction Context
 * Context information for knowledge extraction
 */
export interface ExtractionContext {
  /** Conversation ID */
  conversationId: string;
  /** User ID */
  userId: string;
  /** Task description */
  task: string;
  /** Final result */
  result: string;
  /** Number of conversation turns */
  turnCount: number;
  /** Whether execution was successful */
  success: boolean;
}

/**
 * Knowledge Extractor Class
 * Analyzes conversations and extracts structured knowledge
 */
export class KnowledgeExtractor {
  private llm: LLMProvider;
  private memoryStorage: MemoryStorage;

  constructor(
    llm: LLMProvider,
    memoryStorage: MemoryStorage
  ) {
    this.llm = llm;
    this.memoryStorage = memoryStorage;
  }

  /**
   * Extract knowledge from a conversation
   *
   * Extraction Process:
   * 1. Load tool executions from MemoryStorage
   * 2. Analyze tool execution sequence
   * 3. Use LLM to generate knowledge structure
   * 4. Calculate confidence score
   * 5. Return extracted knowledge(s)
   *
   * @param context Extraction context with task and result information
   * @returns Array of extracted knowledge items
   */
  async extract(context: ExtractionContext): Promise<ExtractedKnowledge[]> {
    logger.debug(`[KnowledgeExtractor] Extracting from conversation: ${context.conversationId}`);

    // Load tool executions from memory storage
    const toolExecutions = this.memoryStorage.getToolExecutions(context.conversationId);

    if (!toolExecutions || toolExecutions.length === 0) {
      logger.debug(`[KnowledgeExtractor] No tool executions found for ${context.conversationId}`);
      // Still extract as fact if no tools
      return this.extractFact(context);
    }

    // Determine extraction type based on conversation characteristics
    const extractionType = this.determineExtractionType(context, toolExecutions);

    // Extract knowledge based on type
    const knowledge = await this.extractByType(context, toolExecutions, extractionType);

    logger.info(`[KnowledgeExtractor] Extracted ${knowledge.length} knowledge items from ${context.conversationId}`);
    return knowledge;
  }

  /**
   * Determine extraction type based on conversation characteristics
   */
  private determineExtractionType(
    context: ExtractionContext,
    toolExecutions: MemoryToolExecution[]
  ): 'skill' | 'pattern' | 'fact' {
    // Skill: 2+ tools, successful execution
    if (toolExecutions.length >= 2 && context.success) {
      return 'skill';
    }

    // Pattern: 1 tool, successful execution
    if (toolExecutions.length === 1 && context.success) {
      return 'pattern';
    }

    // Fact: No tools, just information
    if (toolExecutions.length === 0) {
      return 'fact';
    }

    // Default to pattern
    return 'pattern';
  }

  /**
   * Extract knowledge by type
   */
  private async extractByType(
    context: ExtractionContext,
    toolExecutions: MemoryToolExecution[],
    type: 'skill' | 'pattern' | 'fact'
  ): Promise<ExtractedKnowledge[]> {
    switch (type) {
      case 'skill':
        return this.extractSkill(context, toolExecutions);
      case 'pattern':
        return this.extractPattern(context, toolExecutions);
      case 'fact':
        return this.extractFact(context);
    }
  }

  /**
   * Extract a skill (multi-step procedure)
   */
  private async extractSkill(
    context: ExtractionContext,
    toolExecutions: MemoryToolExecution[]
  ): Promise<ExtractedKnowledge[]> {
    // Build tool sequence
    const toolSequence: ToolStep[] = toolExecutions.map((exec) => ({
      tool: exec.toolName,
      argsTemplate: this.simplifyArguments(exec.toolArguments),
      resultPattern: exec.executionResult ? this.extractStringPattern(exec.executionResult) : undefined,
    }));

    // Use LLM to generate title and description
    const analysis = await this.analyzeWithLLM(context.task, toolSequence, context.result, 'skill');

    // Calculate confidence
    const confidence = this.calculateConfidence(context, toolExecutions, 'skill');

    const knowledge: ExtractedKnowledge = {
      type: 'skill',
      title: analysis.title,
      description: analysis.description,
      taskPattern: this.generateTaskPattern(context.task, analysis),
      toolSequence,
      outcome: context.result,
      confidence,
      metadata: {
        learnedFrom: context.conversationId,
        learnedAt: new Date(),
        userId: context.userId,
      },
    };

    return [knowledge];
  }

  /**
   * Extract a pattern (problem-solving approach)
   */
  private async extractPattern(
    context: ExtractionContext,
    toolExecutions: MemoryToolExecution[]
  ): Promise<ExtractedKnowledge[]> {
    const toolSequence: ToolStep[] = toolExecutions.map((exec) => ({
      tool: exec.toolName,
      argsTemplate: this.simplifyArguments(exec.toolArguments),
    }));

    const analysis = await this.analyzeWithLLM(context.task, toolSequence, context.result, 'pattern');
    const confidence = this.calculateConfidence(context, toolExecutions, 'pattern');

    const knowledge: ExtractedKnowledge = {
      type: 'pattern',
      title: analysis.title,
      description: analysis.description,
      taskPattern: this.generateTaskPattern(context.task, analysis),
      toolSequence,
      outcome: context.result,
      confidence,
      metadata: {
        learnedFrom: context.conversationId,
        learnedAt: new Date(),
        userId: context.userId,
      },
    };

    return [knowledge];
  }

  /**
   * Extract a fact (persistent information)
   */
  private async extractFact(context: ExtractionContext): Promise<ExtractedKnowledge[]> {
    const analysis = await this.analyzeWithLLM(context.task, [], context.result, 'fact');
    const confidence = this.calculateConfidence(context, [], 'fact');

    const knowledge: ExtractedKnowledge = {
      type: 'fact',
      title: analysis.title,
      description: analysis.description,
      taskPattern: this.generateTaskPattern(context.task, analysis),
      toolSequence: [],
      outcome: context.result,
      confidence,
      metadata: {
        learnedFrom: context.conversationId,
        learnedAt: new Date(),
        userId: context.userId,
      },
    };

    return [knowledge];
  }

  /**
   * Use LLM to analyze conversation and generate metadata
   */
  private async analyzeWithLLM(
    task: string,
    toolSequence: ToolStep[],
    result: string,
    type: 'skill' | 'pattern' | 'fact'
  ): Promise<{ title: string; description: string }> {
    const prompt = this.buildAnalysisPrompt(task, toolSequence, result, type);

    try {
      const response = await this.llm.generateResponse(
        [
          {
            role: 'system',
            content: 'You are an expert at analyzing task executions and extracting reusable knowledge. Respond only with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        []
      );

      // Parse JSON response
      const content = response.content || '{}';
      const parsed = JSON.parse(content);

      return {
        title: parsed.title || 'Untitled',
        description: parsed.description || 'No description',
      };
    } catch (error) {
      logger.warn('[KnowledgeExtractor] LLM analysis failed, using fallback:', error as Error);
      return this.generateFallbackMetadata(task, toolSequence, type);
    }
  }

  /**
   * Build analysis prompt for LLM
   */
  private buildAnalysisPrompt(
    task: string,
    toolSequence: ToolStep[],
    result: string,
    type: 'skill' | 'pattern' | 'fact'
  ): string {
    const toolSummary = toolSequence
      .map((step, i) => `${i + 1}. ${step.tool}(${JSON.stringify(step.argsTemplate)})`)
      .join('\n');

    return `Analyze this task execution and extract a ${type}:

Task: ${task}

Tool Sequence:
${toolSummary || 'No tools used'}

Result: ${result}

Respond with JSON in this format:
{
  "title": "Brief descriptive title",
  "description": "Clear description of what this ${type} does and when to use it"
}`;
  }

  /**
   * Generate fallback metadata when LLM fails
   */
  private generateFallbackMetadata(
    task: string,
    toolSequence: ToolStep[],
    type: 'skill' | 'pattern' | 'fact'
  ): { title: string; description: string } {
    const tools = toolSequence.map((s) => s.tool).join(', ');
    return {
      title: `${type === 'skill' ? 'Skill' : type === 'pattern' ? 'Pattern' : 'Fact'}: ${task.substring(0, 50)}`,
      description: `Learned from task: ${task}${tools ? `. Uses: ${tools}` : ''}`,
    };
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    context: ExtractionContext,
    toolExecutions: MemoryToolExecution[],
    type: 'skill' | 'pattern' | 'fact'
  ): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence for successful executions
    if (context.success) {
      confidence += 0.2;
    }

    // Increase confidence for efficient execution (few turns)
    if (context.turnCount <= 3) {
      confidence += 0.15;
    } else if (context.turnCount <= 5) {
      confidence += 0.1;
    }

    // Adjust based on type
    switch (type) {
      case 'skill':
        // Skills need multiple tools
        if (toolExecutions.length >= 2) {
          confidence += 0.15;
        }
        break;
      case 'pattern':
        // Patterns need at least one tool
        if (toolExecutions.length >= 1) {
          confidence += 0.15;
        }
        break;
      case 'fact':
        // Facts are simpler, lower confidence by default
        confidence -= 0.1;
        break;
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Simplify arguments by replacing specific values with placeholders
   */
  private simplifyArguments(args: Record<string, unknown>): Record<string, unknown> {
    const simplified: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        // Replace file paths, URLs, etc. with placeholders
        if (value.includes('/') || value.includes('\\')) {
          simplified[key] = '<file_path>';
        } else if (value.includes('http')) {
          simplified[key] = '<url>';
        } else if (value.length > 50) {
          simplified[key] = '<long_string>';
        } else {
          simplified[key] = value;
        }
      } else {
        simplified[key] = value;
      }
    }

    return simplified;
  }

  /**
   * Extract pattern from string
   */
  private extractStringPattern(str: string): string {
    // Simple pattern extraction - take first 100 chars
    return str.substring(0, 100);
  }

  /**
   * Generate task pattern for matching
   */
  private generateTaskPattern(
    task: string,
    analysis: { title: string; description: string }
  ): string {
    // Combine task, title, and description for FTS5 matching
    return `${task} ${analysis.title} ${analysis.description}`.toLowerCase();
  }

  /**
   * Convert ExtractedKnowledge to LearnedSkill for storage
   */
  toLearnedSkill(knowledge: ExtractedKnowledge): LearnedSkill {
    return {
      id: randomUUID(),
      type: knowledge.type,
      title: knowledge.title,
      description: knowledge.description,
      taskPattern: knowledge.taskPattern,
      toolSequence: knowledge.toolSequence,
      outcome: knowledge.outcome,
      metadata: {
        userId: knowledge.metadata.userId,
        learnedFrom: knowledge.metadata.learnedFrom,
        learnedAt: knowledge.metadata.learnedAt,
        timesUsed: 0,
        successRate: 1.0,
        avgDuration: 0,
      },
    };
  }
}
