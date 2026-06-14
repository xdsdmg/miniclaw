/**
 * Learning Storage
 *
 * Manages persistent storage of learned skills, patterns, and facts.
 * Uses SQLite with FTS5 full-text search for skill retrieval.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { logger } from '../logger';

/**
 * Tool Step in a learned skill
 */
export interface ToolStep {
  /** Tool name */
  tool: string;
  /** Argument template (may contain placeholders) */
  argsTemplate: Record<string, unknown>;
  /** Expected result pattern (optional) */
  resultPattern?: string;
}

/**
 * Learned Skill Metadata
 */
export interface SkillMetadata {
  /** User ID who owns this skill */
  userId: string;
  /** Source conversation ID */
  learnedFrom: string;
  /** When the skill was learned */
  learnedAt: Date;
  /** Number of times this skill has been used */
  timesUsed: number;
  /** Last time this skill was used */
  lastUsed?: Date;
  /** Success rate (0-1) */
  successRate: number;
  /** Average execution duration in ms */
  avgDuration: number;
}

/**
 * Learned Skill
 * Complete representation of a learned skill/pattern/fact
 */
export interface LearnedSkill {
  /** Unique skill ID */
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
  /** Skill metadata */
  metadata: SkillMetadata;
}

/**
 * Database Schema for learned skills
 */
const SCHEMA = `
-- Main skills table
CREATE TABLE IF NOT EXISTS learned_skills (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('skill', 'pattern', 'fact')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_pattern TEXT NOT NULL,
  tool_sequence TEXT NOT NULL,
  outcome TEXT NOT NULL,
  user_id TEXT NOT NULL,
  learned_from TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  times_used INTEGER DEFAULT 0,
  last_used INTEGER,
  success_rate REAL DEFAULT 1.0,
  avg_duration INTEGER
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS learned_skills_fts USING fts5(
  title, description, outcome,
  content=learned_skills,
  content_rowid=rowid
);

-- Indexes for user and type lookup
CREATE INDEX IF NOT EXISTS idx_learned_skills_user ON learned_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_learned_skills_type ON learned_skills(type);
CREATE INDEX IF NOT EXISTS idx_learned_skills_success_rate ON learned_skills(success_rate);

-- Trigger to update FTS5 when skills are inserted
CREATE TRIGGER IF NOT EXISTS learned_skills_fts_insert AFTER INSERT ON learned_skills BEGIN
  INSERT INTO learned_skills_fts(rowid, title, description, outcome)
  VALUES (NEW.rowid, NEW.title, NEW.description, NEW.outcome);
END;

-- Trigger to update FTS5 when skills are updated
CREATE TRIGGER IF NOT EXISTS learned_skills_fts_update AFTER UPDATE ON learned_skills BEGIN
  UPDATE learned_skills_fts
  SET title = NEW.title, description = NEW.description, outcome = NEW.outcome
  WHERE rowid = NEW.rowid;
END;

-- Trigger to delete from FTS5 when skills are deleted
CREATE TRIGGER IF NOT EXISTS learned_skills_fts_delete AFTER DELETE ON learned_skills BEGIN
  DELETE FROM learned_skills_fts WHERE rowid = OLD.rowid;
END;
`;

/**
 * Learning Storage Class
 * Manages persistent storage and retrieval of learned skills
 */
export class LearningStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    logger.info('[LearningStorage] Initialized with database:', dbPath);
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    this.db.exec(SCHEMA);
    logger.debug('[LearningStorage] Database schema initialized');
  }

  /**
   * Save a learned skill to storage
   *
   * @param skill The skill to save
   */
  saveSkill(skill: LearnedSkill): void {
    const stmt = this.db.prepare(`
      INSERT INTO learned_skills (
        id, type, title, description, task_pattern, tool_sequence, outcome,
        user_id, learned_from, learned_at, times_used, success_rate, avg_duration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        skill.id,
        skill.type,
        skill.title,
        skill.description,
        skill.taskPattern,
        JSON.stringify(skill.toolSequence),
        skill.outcome,
        skill.metadata.userId,
        skill.metadata.learnedFrom,
        skill.metadata.learnedAt.getTime(),
        skill.metadata.timesUsed,
        skill.metadata.successRate,
        skill.metadata.avgDuration
      );

      logger.info(`[LearningStorage] Saved skill: ${skill.id} (${skill.type})`);
    } catch (error) {
      logger.error('[LearningStorage] Failed to save skill:', error as Error);
      throw error;
    }
  }

  /**
   * Search for relevant skills by task description
   * Uses FTS5 full-text search for semantic matching
   *
   * @param task Task description to search for
   * @param limit Maximum number of results (default: 10)
   * @returns Array of relevant learned skills
   */
  searchSkills(task: string, limit: number = 10): LearnedSkill[] {
    const stmt = this.db.prepare(`
      SELECT
        ls.id, ls.type, ls.title, ls.description, ls.task_pattern as taskPattern,
        ls.tool_sequence as toolSequence, ls.outcome,
        ls.user_id as userId, ls.learned_from as learnedFrom,
        ls.learned_at as learnedAt, ls.times_used as timesUsed,
        ls.last_used as lastUsed, ls.success_rate as successRate,
        ls.avg_duration as avgDuration,
        bm25(learned_skills_fts) as relevance
      FROM learned_skills ls
      INNER JOIN learned_skills_fts fts ON ls.rowid = fts.rowid
      WHERE learned_skills_fts MATCH ?
      ORDER BY relevance, ls.success_rate DESC, ls.times_used DESC
      LIMIT ?
    `);

    try {
      const rows = stmt.all(task, limit) as any[];
      return rows.map(this.rowToSkill);
    } catch (error) {
      logger.error('[LearningStorage] Search failed:', error as Error);
      return [];
    }
  }

  /**
   * Get skills by user ID
   *
   * @param userId User ID to filter by
   * @returns Array of user's learned skills
   */
  getUserSkills(userId: string): LearnedSkill[] {
    const stmt = this.db.prepare(`
      SELECT
        id, type, title, description, task_pattern as taskPattern,
        tool_sequence as toolSequence, outcome,
        user_id as userId, learned_from as learnedFrom,
        learned_at as learnedAt, times_used as timesUsed,
        last_used as lastUsed, success_rate as successRate,
        avg_duration as avgDuration
      FROM learned_skills
      WHERE user_id = ?
      ORDER BY learned_at DESC
    `);

    try {
      const rows = stmt.all(userId) as any[];
      return rows.map(this.rowToSkill);
    } catch (error) {
      logger.error('[LearningStorage] getUserSkills failed:', error as Error);
      return [];
    }
  }

  /**
   * Get skill by ID
   *
   * @param skillId Skill ID to retrieve
   * @returns Skill if found, null otherwise
   */
  getSkill(skillId: string): LearnedSkill | null {
    const stmt = this.db.prepare(`
      SELECT
        id, type, title, description, task_pattern as taskPattern,
        tool_sequence as toolSequence, outcome,
        user_id as userId, learned_from as learnedFrom,
        learned_at as learnedAt, times_used as timesUsed,
        last_used as lastUsed, success_rate as successRate,
        avg_duration as avgDuration
      FROM learned_skills
      WHERE id = ?
    `);

    try {
      const row = stmt.get(skillId) as any;
      return row ? this.rowToSkill(row) : null;
    } catch (error) {
      logger.error('[LearningStorage] getSkill failed:', error as Error);
      return null;
    }
  }

  /**
   * Record skill usage and update statistics
   *
   * @param skillId Skill ID that was used
   * @param success Whether the usage was successful
   * @param duration Execution duration in milliseconds
   */
  recordUsage(skillId: string, success: boolean, duration: number): void {
    const getStmt = this.db.prepare(`
      SELECT times_used, success_rate, avg_duration
      FROM learned_skills
      WHERE id = ?
    `);

    const updateStmt = this.db.prepare(`
      UPDATE learned_skills
      SET
        times_used = times_used + 1,
        last_used = ?,
        success_rate = ?,
        avg_duration = ?
      WHERE id = ?
    `);

    try {
      const current = getStmt.get(skillId) as any;
      if (!current) {
        logger.warn(`[LearningStorage] Skill not found: ${skillId}`);
        return;
      }

      // Calculate new success rate (moving average)
      const newTimesUsed = current.times_used + 1;
      const oldSuccessCount = current.success_rate * current.times_used;
      const newSuccessRate = (oldSuccessCount + (success ? 1 : 0)) / newTimesUsed;

      // Calculate new average duration
      const oldDurationTotal = current.avg_duration * current.times_used;
      const newAvgDuration = (oldDurationTotal + duration) / newTimesUsed;

      updateStmt.run(
        Date.now(),
        newSuccessRate,
        newAvgDuration,
        skillId
      );

      logger.debug(`[LearningStorage] Recorded usage for skill ${skillId}: success=${success}, duration=${duration}ms`);
    } catch (error) {
      logger.error('[LearningStorage] recordUsage failed:', error as Error);
    }
  }

  /**
   * Delete a skill
   *
   * @param skillId Skill ID to delete
   */
  deleteSkill(skillId: string): void {
    const stmt = this.db.prepare('DELETE FROM learned_skills WHERE id = ?');

    try {
      const result = stmt.run(skillId);
      if (result.changes > 0) {
        logger.info(`[LearningStorage] Deleted skill: ${skillId}`);
      } else {
        logger.warn(`[LearningStorage] Skill not found for deletion: ${skillId}`);
      }
    } catch (error) {
      logger.error('[LearningStorage] deleteSkill failed:', error as Error);
      throw error;
    }
  }

  /**
   * Get all skills (for debugging/admin)
   *
   * @returns Array of all learned skills
   */
  getAllSkills(): LearnedSkill[] {
    const stmt = this.db.prepare(`
      SELECT
        id, type, title, description, task_pattern as taskPattern,
        tool_sequence as toolSequence, outcome,
        user_id as userId, learned_from as learnedFrom,
        learned_at as learnedAt, times_used as timesUsed,
        last_used as lastUsed, success_rate as successRate,
        avg_duration as avgDuration
      FROM learned_skills
      ORDER BY learned_at DESC
    `);

    try {
      const rows = stmt.all() as any[];
      return rows.map(this.rowToSkill);
    } catch (error) {
      logger.error('[LearningStorage] getAllSkills failed:', error as Error);
      return [];
    }
  }

  /**
   * Get statistics about stored skills
   *
   * @returns Statistics object
   */
  getStats(): {
    total: number;
    byType: { skill: number; pattern: number; fact: number };
    avgSuccessRate: number;
  } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM learned_skills');
    const typeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM learned_skills
      GROUP BY type
    `);
    const avgStmt = this.db.prepare('SELECT AVG(success_rate) as avg FROM learned_skills');

    try {
      const totalResult = totalStmt.get() as { count: number };
      const typeResults = typeStmt.all() as Array<{ type: string; count: number }>;
      const avgResult = avgStmt.get() as { avg: number | null };

      const byType = { skill: 0, pattern: 0, fact: 0 };
      for (const row of typeResults) {
        if (row.type in byType) {
          byType[row.type as keyof typeof byType] = row.count;
        }
      }

      return {
        total: totalResult.count,
        byType,
        avgSuccessRate: avgResult.avg || 0,
      };
    } catch (error) {
      logger.error('[LearningStorage] getStats failed:', error as Error);
      return { total: 0, byType: { skill: 0, pattern: 0, fact: 0 }, avgSuccessRate: 0 };
    }
  }

  /**
   * Convert database row to LearnedSkill object
   */
  private rowToSkill(row: any): LearnedSkill {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      taskPattern: row.taskPattern,
      toolSequence: JSON.parse(row.toolSequence),
      outcome: row.outcome,
      metadata: {
        userId: row.userId,
        learnedFrom: row.learnedFrom,
        learnedAt: new Date(row.learnedAt),
        timesUsed: row.timesUsed,
        lastUsed: row.lastUsed ? new Date(row.lastUsed) : undefined,
        successRate: row.successRate,
        avgDuration: row.avgDuration,
      },
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info('[LearningStorage] Database connection closed');
  }
}
