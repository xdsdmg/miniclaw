/**
 * Skills System
 *
 * Manages skill loading and application for the learning system.
 */

import { LearningStorage, LearnedSkill, ToolStep } from './storage';
import { logger } from '../logger';

/**
 * Skill for Application
 * Simplified skill interface for application
 */
export interface Skill {
  /** Skill ID */
  id: string;
  /** Skill type */
  type: 'skill' | 'pattern' | 'fact';
  /** Skill title */
  title: string;
  /** Skill description */
  description: string;
  /** Task pattern for matching */
  taskPattern: string;
  /** Tool execution sequence */
  toolSequence: ToolStep[];
  /** Expected outcome */
  outcome: string;
  /** Usage statistics */
  usageStats: {
    timesUsed: number;
    successRate: number;
    lastUsed?: Date;
  };
}

/**
 * Skill Match Result
 * Result of skill-to-task matching
 */
export interface SkillMatch {
  /** Matched skill */
  skill: Skill;
  /** Match confidence score (0-1) */
  confidence: number;
  /** Match reason */
  reason: string;
}

/**
 * Application Mode
 * How a skill should be applied
 */
export type ApplicationMode = 'suggest' | 'template' | 'auto';

/**
 * Skill Application Result
 * Result of applying a skill
 */
export interface SkillApplicationResult {
  /** Applied skill */
  skill: Skill;
  /** Application mode used */
  mode: ApplicationMode;
  /** Generated result */
  result: string;
  /** Whether application was successful */
  success: boolean;
}

/**
 * Skill Loader Class
 * Loads relevant skills for current task
 */
export class SkillLoader {
  private storage: LearningStorage;

  constructor(storage: LearningStorage) {
    this.storage = storage;
  }

  /**
   * Load relevant skills for current task
   *
   * Loading Strategy:
   * 1. FTS5 search for semantically similar skills
   * 2. Filter by user-specific skills if userId provided
   * 3. Sort by: success_rate, times_used, recency
   * 4. Limit to top N skills to avoid context bloat
   *
   * @param task Current task description
   * @param userId Optional user ID for personalization
   * @param limit Maximum skills to return (default: 3)
   * @returns Array of relevant skills with their metadata
   */
  loadRelevantSkills(task: string, userId?: string, limit: number = 3): Skill[] {
    logger.debug(`[SkillLoader] Loading skills for task: "${task}" (user: ${userId || 'global'}, limit: ${limit})`);

    // Search for relevant skills
    let skills: LearnedSkill[];

    if (userId) {
      // Search user-specific skills first
      const userSkills = this.storage.getUserSkills(userId);
      const allSkills = this.storage.searchSkills(task, limit * 2); // Get more candidates

      // Prioritize user skills
      skills = this.prioritizeUserSkills(userSkills, allSkills, limit);
    } else {
      // Search all skills
      skills = this.storage.searchSkills(task, limit);
    }

    // Convert to Skill interface and sort by relevance
    const sortedSkills = this.sortSkillsByRelevance(skills);

    // Apply limit
    const finalSkills = sortedSkills.slice(0, limit);

    logger.debug(`[SkillLoader] Loaded ${finalSkills.length} skills for task: "${task}"`);
    return finalSkills;
  }

  /**
   * Prioritize user-specific skills
   */
  private prioritizeUserSkills(
    userSkills: LearnedSkill[],
    allSkills: LearnedSkill[],
    limit: number
  ): LearnedSkill[] {
    const userSkillIds = new Set(userSkills.map(s => s.id));
    const prioritized: LearnedSkill[] = [];

    // Add user skills first
    for (const skill of allSkills) {
      if (userSkillIds.has(skill.id) && prioritized.length < limit) {
        prioritized.push(skill);
      }
    }

    // Fill remaining slots with other relevant skills
    if (prioritized.length < limit) {
      for (const skill of allSkills) {
        if (!userSkillIds.has(skill.id) && prioritized.length < limit) {
          prioritized.push(skill);
        }
      }
    }

    return prioritized;
  }

  /**
   * Sort skills by relevance
   * Sorting criteria: success_rate, times_used, recency
   */
  private sortSkillsByRelevance(skills: LearnedSkill[]): Skill[] {
    const sorted = skills.map(skill => ({
      skill,
      score: this.calculateRelevanceScore(skill),
    }));

    sorted.sort((a, b) => b.score - a.score);

    return sorted.map(item => this.toSkill(item.skill));
  }

  /**
   * Calculate relevance score for a skill
   * Higher score = more relevant
   */
  private calculateRelevanceScore(skill: LearnedSkill): number {
    let score = 0;

    // Success rate: higher is better
    score += skill.metadata.successRate * 50;

    // Usage count: more used = more proven (capped at 20)
    score += Math.min(skill.metadata.timesUsed, 20);

    // Recency bonus: recent usage (within 7 days) gets bonus
    if (skill.metadata.lastUsed) {
      const daysSinceLastUse = (Date.now() - skill.metadata.lastUsed.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUse < 7) {
        score += 10 * (1 - daysSinceLastUse / 7);
      }
    }

    return score;
  }

  /**
   * Format skills for LLM context
   *
   * Format:
   * ## Relevant Skills
   *
   * ### Skill: Deploy to Production
   * **Description**: Deploy application using git and kubectl
   * **Success Rate**: 95% (used 20 times)
   * **Steps**:
   * 1. Run: git push origin main
   * 2. Run: kubectl apply -f deployment.yaml
   * 3. Run: kubectl rollout status deployment/app
   */
  formatSkillsForContext(skills: Skill[]): string {
    if (skills.length === 0) {
      return '';
    }

    let formatted = '## Relevant Skills\n\n';

    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      formatted += `### ${i + 1}. ${skill.title}\n`;
      formatted += `**Type**: ${skill.type}\n`;
      formatted += `**Description**: ${skill.description}\n`;
      formatted += `**Success Rate**: ${(skill.usageStats.successRate * 100).toFixed(1)}% `;
      formatted += `(used ${skill.usageStats.timesUsed} time${skill.usageStats.timesUsed !== 1 ? 's' : ''})\n`;

      if (skill.toolSequence.length > 0) {
        formatted += '**Steps**:\n';
        for (let j = 0; j < skill.toolSequence.length; j++) {
          const step = skill.toolSequence[j];
          formatted += `  ${j + 1}. Run: ${step.tool} ${JSON.stringify(step.argsTemplate)}\n`;
        }
      }

      formatted += '\n';
    }

    return formatted;
  }

  /**
   * Convert LearnedSkill to Skill interface
   */
  private toSkill(learnedSkill: LearnedSkill): Skill {
    return {
      id: learnedSkill.id,
      type: learnedSkill.type,
      title: learnedSkill.title,
      description: learnedSkill.description,
      taskPattern: learnedSkill.taskPattern,
      toolSequence: learnedSkill.toolSequence,
      outcome: learnedSkill.outcome,
      usageStats: {
        timesUsed: learnedSkill.metadata.timesUsed,
        successRate: learnedSkill.metadata.successRate,
        lastUsed: learnedSkill.metadata.lastUsed,
      },
    };
  }
}

/**
 * Skill Application Class
 * Applies learned skills to current tasks
 */
export class SkillApplication {
  /**
   * Apply skill to current task
   *
   * Application Modes:
   * 1. SUGGEST: Add skill to context as reference (default)
   * 2. TEMPLATE: Generate code from skill template
   * 3. AUTO: Automatically execute tool sequence (high risk)
   *
   * @param skill The skill to apply
   * @param task Current task context
   * @param mode Application mode
   */
  async applySkill(skill: Skill, task: string, mode: ApplicationMode): Promise<SkillApplicationResult> {
    logger.debug(`[SkillApplication] Applying skill "${skill.title}" in ${mode} mode`);

    switch (mode) {
      case 'suggest':
        return this.suggestSkill(skill, task);
      case 'template':
        return this.generateFromTemplate(skill, task);
      case 'auto':
        return this.executeSkillAutomatically(skill, task);
      default:
        throw new Error(`Unknown application mode: ${mode}`);
    }
  }

  /**
   * Suggest skill - add to context as reference
   */
  private async suggestSkill(skill: Skill, task: string): Promise<SkillApplicationResult> {
    const result = `Consider using the "${skill.title}" skill for this task.\n\n${this.formatSkill(skill)}`;
    return {
      skill,
      mode: 'suggest',
      result,
      success: true,
    };
  }

  /**
   * Generate from template
   * Extract patterns and apply to current task
   */
  private async generateFromTemplate(skill: Skill, task: string): Promise<SkillApplicationResult> {
    // Simple template generation - replace placeholders with task-specific values
    // In a more advanced implementation, this could use LLM to generate code
    const result = `Generated from "${skill.title}" template:\n\n${this.formatSkill(skill)}`;
    return {
      skill,
      mode: 'template',
      result,
      success: true,
    };
  }

  /**
   * Execute skill automatically
   * Execute tool sequence directly (high confidence required)
   */
  private async executeSkillAutomatically(skill: Skill, task: string): Promise<SkillApplicationResult> {
    if (skill.usageStats.successRate < 0.8) {
      throw new Error(`Cannot auto-execute skill with success rate ${skill.usageStats.successRate}`);
    }

    // Build execution plan
    const steps = skill.toolSequence.map(step => ({
      tool: step.tool,
      args: step.argsTemplate,
    }));

    const result = `Auto-executing "${skill.title}":\n\n` + steps.map((step, i) =>
      `${i + 1}. ${step.tool} ${JSON.stringify(step.args)}`
    ).join('\n');

    return {
      skill,
      mode: 'auto',
      result,
      success: true,
    };
  }

  /**
   * Match task to skill
   *
   * Matching Strategies:
   * 1. Semantic similarity (via FTS5 search score)
   * 2. Keyword matching
   * 3. Pattern matching (if skill has taskPattern)
   *
   * @param task Current task
   * @param skill Skill to match
   * @returns Confidence score (0-1)
   */
  matchTaskToSkill(task: string, skill: Skill): number {
    let confidence = 0;

    // Strategy 1: Keyword matching
    const taskWords = task.toLowerCase().split(/\s+/);
    const skillWords = skill.title.toLowerCase().split(/\s+/);
    const matchCount = taskWords.filter(word => skillWords.includes(word)).length;
    const matchRatio = matchCount / Math.max(taskWords.length, 1);

    confidence += matchRatio * 0.5;

    // Strategy 2: Success rate bonus
    confidence += skill.usageStats.successRate * 0.3;

    // Strategy 3: Usage frequency bonus
    const usageBonus = Math.min(skill.usageStats.timesUsed / 100, 0.2);
    confidence += usageBonus;

    return Math.min(confidence, 1);
  }

  /**
   * Format skill for display
   */
  private formatSkill(skill: Skill): string {
    let formatted = `**${skill.title}**\n`;
    formatted += `Description: ${skill.description}\n`;
    formatted += `Success Rate: ${(skill.usageStats.successRate * 100).toFixed(1)}%\n`;

    if (skill.toolSequence.length > 0) {
      formatted += 'Tool Sequence:\n';
      skill.toolSequence.forEach((step, i) => {
        formatted += `  ${i + 1}. ${step.tool} ${JSON.stringify(step.argsTemplate)}\n`;
      });
    }

    return formatted;
  }
}
