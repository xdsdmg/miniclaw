/**
 * Learning Storage Tests
 */

import { LearningStorage, LearnedSkill } from '../../src/learning/storage.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

describe('LearningStorage', () => {
  const testDbPath = join(__dirname, 'test-learning.db');
  let storage: LearningStorage;

  beforeEach(() => {
    // Create fresh database for each test
    storage = new LearningStorage(testDbPath);
  });

  afterEach(() => {
    // Clean up test database
    storage.close();
    try {
      unlinkSync(testDbPath);
      unlinkSync(testDbPath + '-wal');
      unlinkSync(testDbPath + '-shm');
    } catch {
      // File might not exist
    }
  });

  describe('saveSkill', () => {
    it('should save a skill to database', () => {
      const skill: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'Deploy to Production',
        description: 'Deploy application using git and kubectl',
        taskPattern: 'deploy production',
        toolSequence: [
          {
            tool: 'bash',
            argsTemplate: { command: 'git push origin main' },
          },
          {
            tool: 'bash',
            argsTemplate: { command: 'kubectl apply -f deployment.yaml' },
          },
        ],
        outcome: 'Successfully deployed',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 5000,
        },
      };

      storage.saveSkill(skill);

      const retrieved = storage.getSkill('skill-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe('Deploy to Production');
      expect(retrieved?.toolSequence).toHaveLength(2);
    });

    it('should save pattern type', () => {
      const skill: LearnedSkill = {
        id: 'pattern-1',
        type: 'pattern',
        title: 'File Analysis Pattern',
        description: 'Read, parse, and transform files',
        taskPattern: 'analyze file',
        toolSequence: [
          {
            tool: 'bash',
            argsTemplate: { command: 'cat file.txt' },
          },
        ],
        outcome: 'File analyzed',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-2',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 2000,
        },
      };

      storage.saveSkill(skill);
      const retrieved = storage.getSkill('pattern-1');
      expect(retrieved?.type).toBe('pattern');
    });

    it('should save fact type', () => {
      const skill: LearnedSkill = {
        id: 'fact-1',
        type: 'fact',
        title: 'User prefers Python',
        description: 'User prefers Python over JavaScript',
        taskPattern: 'code generation',
        toolSequence: [],
        outcome: 'User preference recorded',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-3',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 0,
        },
      };

      storage.saveSkill(skill);
      const retrieved = storage.getSkill('fact-1');
      expect(retrieved?.type).toBe('fact');
    });
  });

  describe('getSkill', () => {
    it('should return null for non-existent skill', () => {
      const result = storage.getSkill('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('searchSkills', () => {
    beforeEach(() => {
      // Seed test data
      const skills: LearnedSkill[] = [
        {
          id: 'skill-1',
          type: 'skill',
          title: 'Deploy to Production',
          description: 'Deploy application using git and kubectl',
          taskPattern: 'deploy production',
          toolSequence: [
            { tool: 'bash', argsTemplate: { command: 'git push' } },
          ],
          outcome: 'Deployed',
          metadata: {
            userId: 'user-1',
            learnedFrom: 'conv-1',
            learnedAt: new Date(),
            timesUsed: 5,
            successRate: 0.95,
            avgDuration: 5000,
          },
        },
        {
          id: 'skill-2',
          type: 'skill',
          title: 'Run Tests',
          description: 'Execute test suite',
          taskPattern: 'run tests',
          toolSequence: [
            { tool: 'bash', argsTemplate: { command: 'npm test' } },
          ],
          outcome: 'Tests passed',
          metadata: {
            userId: 'user-1',
            learnedFrom: 'conv-2',
            learnedAt: new Date(),
            timesUsed: 10,
            successRate: 1.0,
            avgDuration: 3000,
          },
        },
      ];

      skills.forEach((skill) => storage.saveSkill(skill));
    });

    it('should search skills by task description', () => {
      const results = storage.searchSkills('deploy', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Deploy');
    });

    it('should return empty array for no matches', () => {
      const results = storage.searchSkills('nonexistent task', 10);
      expect(results).toHaveLength(0);
    });

    it('should limit results', () => {
      const results = storage.searchSkills('production OR tests', 1);
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe('getUserSkills', () => {
    beforeEach(() => {
      const skill1: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'User 1 Skill',
        description: 'For user 1',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      const skill2: LearnedSkill = {
        id: 'skill-2',
        type: 'skill',
        title: 'User 2 Skill',
        description: 'For user 2',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-2',
          learnedFrom: 'conv-2',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      storage.saveSkill(skill1);
      storage.saveSkill(skill2);
    });

    it('should return only user-specific skills', () => {
      const user1Skills = storage.getUserSkills('user-1');
      expect(user1Skills).toHaveLength(1);
      expect(user1Skills[0].metadata.userId).toBe('user-1');

      const user2Skills = storage.getUserSkills('user-2');
      expect(user2Skills).toHaveLength(1);
      expect(user2Skills[0].metadata.userId).toBe('user-2');
    });
  });

  describe('recordUsage', () => {
    it('should update usage statistics', () => {
      const skill: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'Test Skill',
        description: 'Test',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      storage.saveSkill(skill);

      // Record successful usage
      storage.recordUsage('skill-1', true, 2000);
      storage.recordUsage('skill-1', true, 3000);

      const updated = storage.getSkill('skill-1');
      expect(updated?.metadata.timesUsed).toBe(2);
      expect(updated?.metadata.lastUsed).toBeDefined();
      expect(updated?.metadata.successRate).toBe(1.0);
      expect(updated?.metadata.avgDuration).toBe(2500); // (2000 + 3000) / 2

      // Record failed usage
      storage.recordUsage('skill-1', false, 4000);

      const updated2 = storage.getSkill('skill-1');
      expect(updated2?.metadata.timesUsed).toBe(3);
      expect(updated2?.metadata.successRate).toBeCloseTo(0.667, 1); // 2/3
    });
  });

  describe('deleteSkill', () => {
    it('should delete skill from database', () => {
      const skill: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'To Delete',
        description: 'Will be deleted',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      storage.saveSkill(skill);
      expect(storage.getSkill('skill-1')).toBeDefined();

      storage.deleteSkill('skill-1');
      expect(storage.getSkill('skill-1')).toBeNull();
    });

    it('should handle deletion of non-existent skill', () => {
      // Should not throw
      expect(() => storage.deleteSkill('non-existent')).not.toThrow();
    });
  });

  describe('getAllSkills', () => {
    it('should return all skills', () => {
      const skill1: LearnedSkill = {
        id: 'skill-1',
        type: 'skill',
        title: 'Skill 1',
        description: 'First',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-1',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      const skill2: LearnedSkill = {
        id: 'skill-2',
        type: 'pattern',
        title: 'Skill 2',
        description: 'Second',
        taskPattern: 'test',
        toolSequence: [],
        outcome: 'Done',
        metadata: {
          userId: 'user-1',
          learnedFrom: 'conv-2',
          learnedAt: new Date(),
          timesUsed: 0,
          successRate: 1.0,
          avgDuration: 1000,
        },
      };

      storage.saveSkill(skill1);
      storage.saveSkill(skill2);

      const all = storage.getAllSkills();
      expect(all).toHaveLength(2);
    });
  });

  describe('getStats', () => {
    it('should return statistics about stored skills', () => {
      const skills: LearnedSkill[] = [
        {
          id: 'skill-1',
          type: 'skill',
          title: 'Skill 1',
          description: 'First',
          taskPattern: 'test',
          toolSequence: [],
          outcome: 'Done',
          metadata: {
            userId: 'user-1',
            learnedFrom: 'conv-1',
            learnedAt: new Date(),
            timesUsed: 0,
            successRate: 0.9,
            avgDuration: 1000,
          },
        },
        {
          id: 'pattern-1',
          type: 'pattern',
          title: 'Pattern 1',
          description: 'Second',
          taskPattern: 'test',
          toolSequence: [],
          outcome: 'Done',
          metadata: {
            userId: 'user-1',
            learnedFrom: 'conv-2',
            learnedAt: new Date(),
            timesUsed: 0,
            successRate: 0.8,
            avgDuration: 2000,
          },
        },
        {
          id: 'fact-1',
          type: 'fact',
          title: 'Fact 1',
          description: 'Third',
          taskPattern: 'test',
          toolSequence: [],
          outcome: 'Done',
          metadata: {
            userId: 'user-1',
            learnedFrom: 'conv-3',
            learnedAt: new Date(),
            timesUsed: 0,
            successRate: 1.0,
            avgDuration: 0,
          },
        },
      ];

      skills.forEach((skill) => storage.saveSkill(skill));

      const stats = storage.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byType.skill).toBe(1);
      expect(stats.byType.pattern).toBe(1);
      expect(stats.byType.fact).toBe(1);
      expect(stats.avgSuccessRate).toBeCloseTo(0.9, 1);
    });

    it('should return zero stats for empty database', () => {
      const stats = storage.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byType.skill).toBe(0);
      expect(stats.byType.pattern).toBe(0);
      expect(stats.byType.fact).toBe(0);
    });
  });
});
