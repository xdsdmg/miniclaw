/**
 * Skills System Tests
 */

import { SkillLoader, SkillApplication, Skill, ApplicationMode } from '../../src/learning/skills.js';
import { LearningStorage, LearnedSkill } from '../../src/learning/storage.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

describe('SkillLoader', () => {
  const testDbPath = join(__dirname, 'test-skills.db');
  let loader: SkillLoader;
  let storage: LearningStorage;

  beforeEach(() => {
    storage = new LearningStorage(testDbPath);
    loader = new SkillLoader(storage);
  });

  afterEach(() => {
    // Clean up
    try {
      unlinkSync(testDbPath);
      try { unlinkSync(testDbPath + '-wal'); } catch {}
      try { unlinkSync(testDbPath + '-shm'); } catch {}
    } catch {
      // File might not exist
    }
  });

  describe('loadRelevantSkills', () => {
    it('should load skills by task search', () => {
      // Seed test data
      const skill1: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'Deploy to Production',
        description: 'Deploy application using git and kubectl',
        taskPattern: 'deploy production git kubectl',
        toolSequence: [
          { tool: 'bash', argsTemplate: { command: 'git push' } },
          { tool: 'bash', argsTemplate: { command: 'kubectl apply' } },
        ],
        outcome: 'Deployed',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 10,
          successRate: 0.95,
          avgDuration: 5000,
        },
      };

      storage.saveSkill(skill1);

      const skills = loader.loadRelevantSkills('deploy application', undefined, 3);
      expect(skills).toHaveLength(1);
      expect(skills[0].title).toContain('Deploy');
    });

    it('should prioritize user-specific skills', () => {
      const userId = 'user-1';

      // Create skills for user-1
      const userSkill: LearnedSkill = {
        id: 'skill-2',
        type: 'skill',
        title: 'User 1 Deploy',
        description: 'Deploy for user 1',
        taskPattern: 'deploy application git push',
        toolSequence: [],
        outcome: 'Deployed',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-2',
          learnedAt: new Date(),
          timesUsed: 5,
          successRate: 0.9,
          avgDuration: 4000,
        },
      };

      // Create skill for other user
      const otherSkill: LearnedSkill = {
        id: 'skill-3',
        type: 'skill',
        title: 'Other Deploy',
        description: 'Deploy for others',
        taskPattern: 'deploy application kubernetes',
        toolSequence: [],
        outcome: 'Deployed',
        metadata: {
          userId: 'user-2',
          learnedFrom: 'conv-3',
          learnedAt: new Date(),
          timesUsed: 20,
          successRate: 1.0,
          avgDuration: 3000,
        },
      };

      storage.saveSkill(userSkill);
      storage.saveSkill(otherSkill);

      // Wait for FTS5 indexing
      const skills = loader.loadRelevantSkills('deploy', userId, 10);
      expect(skills.length).toBeGreaterThan(0);
      // User skill should be included
      expect(skills.some(s => s.id === 'skill-2')).toBe(true);
    });

    it('should return empty array when no skills match', () => {
      const skills = loader.loadRelevantSkills('nonexistent task', undefined, 3);
      expect(skills).toHaveLength(0);
    });

    it('should limit results to specified limit', () => {
      // Create multiple skills
      for (let i = 0; i < 5; i++) {
        const skill: LearnedSkill = {
          id: `skill-${i}`,
          type: 'skill',
          title: `Test Skill ${i}`,
          description: `Test skill ${i}`,
          taskPattern: 'test',
          toolSequence: [],
          outcome: 'Test result',
          metadata: {
            userId: 'user-1',
            learnedFrom: `conv-${i}`,
            learnedAt: new Date(),
            timesUsed: i,
            successRate: 1.0,
            avgDuration: 1000,
          },
        };
        storage.saveSkill(skill);
      }

      const skills = loader.loadRelevantSkills('test', undefined, 2);
      expect(skills.length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatSkillsForContext', () => {
    it('should format skills for LLM context', () => {
      const skills: Skill[] = [
        {
          id: 'skill-1',
          type: 'skill',
          title: 'Deploy to Production',
          description: 'Deploy application',
          taskPattern: 'deploy',
          toolSequence: [
            { tool: 'bash', argsTemplate: { command: 'git push' } },
            { tool: 'bash', argsTemplate: { command: 'kubectl apply' } },
          ],
          outcome: 'Deployed',
          usageStats: { timesUsed: 10, successRate: 0.95 },
        },
      ];

      const formatted = loader.formatSkillsForContext(skills);

      expect(formatted).toContain('## Relevant Skills');
      expect(formatted).toContain('Deploy to Production');
      expect(formatted).toContain('95.0%');
      expect(formatted).toContain('(used 10 times)');
      expect(formatted).toContain('git push');
      expect(formatted).toContain('kubectl apply');
    });

    it('should return empty string for no skills', () => {
      const formatted = loader.formatSkillsForContext([]);
      expect(formatted).toBe('');
    });
  });

  describe('sortSkillsByRelevance', () => {
    it('should sort by success rate and usage', () => {
      // Create skills with different success rates
      const skill1: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'High Success',
        description: 'High success rate',
        taskPattern: 'success',
        toolSequence: [],
        outcome: 'Result',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 100,
          successRate: 0.95,
          avgDuration: 1000,
        },
      };

      const skill2: LearnedSkill = {
        id: 'skill-2',
        type: 'skill',
        title: 'Low Success',
        description: 'Low success rate',
        taskPattern: 'success',
        toolSequence: [],
        outcome: 'Result',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-2',
          learnedAt: new Date(),
          timesUsed: 5,
          successRate: 0.5,
          avgDuration: 2000,
        },
      };

      storage.saveSkill(skill1);
      storage.saveSkill(skill2);

      const skills = loader.loadRelevantSkills('success', undefined, 10);

      // Higher success rate should come first
      expect(skills.length).toBeGreaterThan(0);
      expect(skills[0].title).toBe('High Success');
      expect(skills[1].title).toBe('Low Success');
    });
  });
});

describe('SkillApplication', () => {
  let app: SkillApplication;

  beforeEach(() => {
    app = new SkillApplication();
  });

  describe('applySkill', () => {
    const mockSkill: Skill = {
      id: 'skill-1',
      type: 'skill',
      title: 'Test Skill',
      description: 'Test description',
      taskPattern: 'test',
      toolSequence: [
        { tool: 'bash', argsTemplate: { command: 'echo test' } },
      ],
      outcome: 'Test result',
      usageStats: { timesUsed: 5, successRate: 0.9 },
    };

    it('should suggest skill in suggest mode', async () => {
      const result = await app.applySkill(mockSkill, 'test task', 'suggest');

      expect(result.mode).toBe('suggest');
      expect(result.success).toBe(true);
      expect(result.result).toContain('Test Skill');
      expect(result.result).toContain('Consider using');
    });

    it('should generate from template in template mode', async () => {
      const result = await app.applySkill(mockSkill, 'test task', 'template');

      expect(result.mode).toBe('template');
      expect(result.success).toBe(true);
      expect(result.result).toContain('Generated from');
    });

    it('should execute skill automatically in auto mode', async () => {
      const result = await app.applySkill(mockSkill, 'test task', 'auto');

      expect(result.mode).toBe('auto');
      expect(result.success).toBe(true);
      expect(result.result).toContain('Auto-executing');
    });

    it('should reject auto mode for low success rate skills', async () => {
      const lowSuccessSkill: Skill = {
        ...mockSkill,
        usageStats: { timesUsed: 5, successRate: 0.5 },
      };

      await expect(app.applySkill(lowSuccessSkill, 'test task', 'auto'))
        .rejects.toThrow('success rate');
    });

    it('should throw error for unknown mode', async () => {
      await expect(app.applySkill(mockSkill, 'test task', 'unknown' as ApplicationMode))
        .rejects.toThrow('Unknown application mode');
    });
  });

  describe('matchTaskToSkill', () => {
    const mockSkill: Skill = {
      id: 'skill-1',
      type: 'skill',
      title: 'Deploy Application',
      description: 'Deploy to production',
      taskPattern: 'deploy production git kubectl',
      toolSequence: [],
      outcome: 'Deployed',
      usageStats: { timesUsed: 10, successRate: 0.9 },
    };

    it('should match similar tasks', () => {
      const confidence = app.matchTaskToSkill('deploy my application to production', mockSkill);
      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });

    it('should give higher confidence for high success rate skills', () => {
      const highSuccessSkill: Skill = {
        ...mockSkill,
        usageStats: { timesUsed: 100, successRate: 0.95 },
      };

      const lowSuccessSkill: Skill = {
        ...mockSkill,
        usageStats: { timesUsed: 10, successRate: 0.5 },
      };

      const highConfidence = app.matchTaskToSkill('deploy app', highSuccessSkill);
      const lowConfidence = app.matchTaskToSkill('deploy app', lowSuccessSkill);

      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });

    it('should give higher confidence for frequently used skills', () => {
      const frequentSkill: Skill = {
        ...mockSkill,
        usageStats: { timesUsed: 100, successRate: 0.8 },
      };

      const rareSkill: Skill = {
        ...mockSkill,
        usageStats: { timesUsed: 2, successRate: 0.8 },
      };

      const frequentConfidence = app.matchTaskToSkill('deploy app', frequentSkill);
      const rareConfidence = app.matchTaskToSkill('deploy app', rareSkill);

      expect(frequentConfidence).toBeGreaterThanOrEqual(rareConfidence);
    });
  });
});
