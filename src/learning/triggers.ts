/**
 * Learning Triggers
 *
 * Evaluates whether a conversation should be learned from.
 * Only high-quality, successful executions should trigger learning.
 */

import { logger } from '../logger';

/**
 * Learning Context
 * Information about a conversation execution for learning evaluation
 */
export interface LearningContext {
  /** Conversation ID from memory system */
  conversationId: string;
  /** User ID who executed the task */
  userId: string;
  /** Task description */
  task: string;
  /** Task execution result */
  result: string;
  /** Number of conversation turns (LLM interactions) */
  turnCount: number;
  /** Number of tool calls made */
  toolCallCount: number;
  /** Whether any errors occurred during execution */
  hadErrors: boolean;
  /** Whether the agent recovered from errors */
  recovered: boolean;
  /** Execution duration in milliseconds */
  duration: number;
}

/**
 * Learning Trigger Result
 * Result of learning trigger evaluation
 */
export interface LearningTriggerResult {
  /** Whether learning should be triggered */
  shouldLearn: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Quality level of the execution */
  quality: 'high' | 'medium' | 'low';
  /** Type of learning that should be applied */
  learningType: 'skill' | 'pattern' | 'fact';
  /** Calculated score (0-10) */
  score: number;
}

/**
 * Scoring Configuration
 * Thresholds and weights for learning evaluation
 */
interface ScoringConfig {
  /** Minimum score to trigger learning */
  minLearningScore: number;
  /** Score threshold for high quality */
  highQualityThreshold: number;
  /** Score threshold for medium quality */
  mediumQualityThreshold: number;
}

/**
 * Learning Triggers Class
 * Evaluates conversations to determine if they should be learned from
 */
export class LearningTriggers {
  private config: ScoringConfig;

  constructor(config?: Partial<ScoringConfig>) {
    this.config = {
      minLearningScore: config?.minLearningScore || 4,
      highQualityThreshold: config?.highQualityThreshold || 6,
      mediumQualityThreshold: config?.mediumQualityThreshold || 4,
    };
  }

  /**
   * Evaluate if a conversation should be learned from
   *
   * Scoring System:
   * - Turn count score: 1-3 turns = 3, 4-6 turns = 2, 7+ turns = 0
   * - Tool count score: 2-5 tools = 3, 1 tool = 1, 0 tools = 0
   * - Error recovery score: recovered = 2, no errors = 1, had errors = 0
   *
   * Total score = turn score + tool score + recovery score
   * - Score >= 5: High quality (learn as skill)
   * - Score 3-4: Medium quality (learn as pattern)
   * - Score < 3: Low quality (do not learn)
   *
   * @param context The learning context to evaluate
   * @returns Learning trigger evaluation result
   */
  evaluate(context: LearningContext): LearningTriggerResult {
    // Calculate individual scores
    const turnScore = this.scoreTurnCount(context.turnCount);
    const toolScore = this.scoreToolCount(context.toolCallCount);
    const recoveryScore = this.scoreRecovery(context.hadErrors, context.recovered);

    // Calculate total score
    const totalScore = turnScore + toolScore + recoveryScore;

    logger.debug(`[LearningTriggers] Evaluation:`, {
      conversationId: context.conversationId,
      turnCount: context.turnCount,
      toolCallCount: context.toolCallCount,
      hadErrors: context.hadErrors,
      recovered: context.recovered,
      scores: { turn: turnScore, tool: toolScore, recovery: recoveryScore },
      total: totalScore,
    });

    // Determine quality level
    let quality: 'high' | 'medium' | 'low';
    let learningType: 'skill' | 'pattern' | 'fact';

    if (totalScore >= this.config.highQualityThreshold) {
      quality = 'high';
      // High quality with multiple tools -> skill
      learningType = context.toolCallCount >= 2 ? 'skill' : 'pattern';
    } else if (totalScore >= this.config.mediumQualityThreshold) {
      quality = 'medium';
      learningType = 'pattern';
    } else {
      quality = 'low';
      learningType = 'fact'; // Won't be used since we won't learn
    }

    // Determine if learning should be triggered
    const shouldLearn = totalScore >= this.config.minLearningScore;

    // Generate reason
    const reason = this.generateReason(shouldLearn, totalScore, context);

    const result: LearningTriggerResult = {
      shouldLearn,
      reason,
      quality,
      learningType,
      score: totalScore,
    };

    logger.info(`[LearningTriggers] Evaluation result:`, {
      shouldLearn,
      quality,
      learningType,
      score: totalScore,
      reason,
    });

    return result;
  }

  /**
   * Score the turn count
   * Fewer turns is better - indicates efficient problem solving
   */
  private scoreTurnCount(turnCount: number): number {
    if (turnCount >= 1 && turnCount <= 2) {
      return 3; // High efficiency
    } else if (turnCount === 3) {
      return 2; // Medium efficiency
    } else if (turnCount >= 4 && turnCount <= 5) {
      return 1; // Low efficiency
    } else {
      return 0; // Too many iterations
    }
  }

  /**
   * Score the tool count
   * Multiple tools suggest complex, reusable patterns
   * But not too many (could be aimless exploration)
   */
  private scoreToolCount(toolCallCount: number): number {
    if (toolCallCount >= 2 && toolCallCount <= 5) {
      return 3; // Good complexity
    } else if (toolCallCount === 1) {
      return 1; // Simple, but still useful
    } else {
      return 0; // No tools or too many tools
    }
  }

  /**
   * Score error recovery
   * Successful recovery from errors is valuable learning material
   */
  private scoreRecovery(hadErrors: boolean, recovered: boolean): number {
    if (hadErrors && recovered) {
      return 2; // Learned from mistakes - most valuable
    } else if (!hadErrors) {
      return 0; // Clean execution - no learning value
    } else {
      return -1; // Failed to recover - penalty
    }
  }

  /**
   * Generate human-readable reason for learning decision
   */
  private generateReason(shouldLearn: boolean, score: number, context: LearningContext): string {
    if (!shouldLearn) {
      return `Score ${score} below threshold. Low quality execution: too many turns (${context.turnCount}), insufficient tool usage (${context.toolCallCount}), or unrecovered errors.`;
    }

    const reasons: string[] = [];
    reasons.push(`Score ${score}`);

    if (context.turnCount <= 3) {
      reasons.push('efficient execution');
    }
    if (context.toolCallCount >= 2) {
      reasons.push('multi-tool pattern');
    }
    if (context.hadErrors && context.recovered) {
      reasons.push('successful error recovery');
    }

    return `High quality execution: ${reasons.join(', ')}.`;
  }

  /**
   * Update scoring configuration
   */
  updateConfig(config: Partial<ScoringConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('[LearningTriggers] Configuration updated:', {
      ...this.config,
    } as Record<string, unknown>);
  }

  /**
   * Get current configuration
   */
  getConfig(): ScoringConfig {
    return { ...this.config };
  }
}
