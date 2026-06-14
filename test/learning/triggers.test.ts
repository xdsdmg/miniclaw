/**
 * Learning Triggers Tests
 */

import { LearningTriggers, LearningContext } from '../../src/learning/triggers.js';

describe('LearningTriggers', () => {
  let triggers: LearningTriggers;

  beforeEach(() => {
    triggers = new LearningTriggers();
  });

  describe('evaluate', () => {
    it('should trigger learning for high-quality multi-tool execution', () => {
      const context: LearningContext = {
        conversationId: 'conv-1',
        userId: 'user-1',
        task: 'Deploy application to production',
        result: 'Successfully deployed',
        turnCount: 2,
        toolCallCount: 3,
        hadErrors: false,
        recovered: false,
        duration: 5000,
      };

      const result = triggers.evaluate(context);

      expect(result.shouldLearn).toBe(true);
      expect(result.quality).toBe('high');
      expect(result.learningType).toBe('skill');
      expect(result.score).toBeGreaterThanOrEqual(5);
    });

    it('should trigger learning for successful error recovery', () => {
      const context: LearningContext = {
        conversationId: 'conv-2',
        userId: 'user-1',
        task: 'Debug and fix API issue',
        result: 'Fixed after retry',
        turnCount: 3,
        toolCallCount: 2,
        hadErrors: true,
        recovered: true,
        duration: 8000,
      };

      const result = triggers.evaluate(context);

      expect(result.shouldLearn).toBe(true);
      expect(result.quality).toBe('high');
      expect(result.reason).toContain('error recovery');
    });

    it('should not trigger learning for failed execution', () => {
      const context: LearningContext = {
        conversationId: 'conv-3',
        userId: 'user-1',
        task: 'Deploy application',
        result: 'Failed to deploy',
        turnCount: 5,
        toolCallCount: 2,
        hadErrors: true,
        recovered: false,
        duration: 10000,
      };

      const result = triggers.evaluate(context);

      expect(result.shouldLearn).toBe(false);
      expect(result.quality).toBe('low');
    });

    it('should not trigger learning for simple LLM-only tasks', () => {
      const context: LearningContext = {
        conversationId: 'conv-4',
        userId: 'user-1',
        task: 'What is 2+2?',
        result: '4',
        turnCount: 1,
        toolCallCount: 0,
        hadErrors: false,
        recovered: false,
        duration: 1000,
      };

      const result = triggers.evaluate(context);

      // Score will be 3, below learning threshold of 4
      expect(result.shouldLearn).toBe(false);
      expect(result.score).toBe(3);
    });

    it('should score medium quality for longer but successful executions', () => {
      const context: LearningContext = {
        conversationId: 'conv-5',
        userId: 'user-1',
        task: 'Complex data analysis',
        result: 'Analysis complete',
        turnCount: 5,
        toolCallCount: 3,
        hadErrors: false,
        recovered: false,
        duration: 15000,
      };

      const result = triggers.evaluate(context);

      expect(result.shouldLearn).toBe(true);
      expect(result.quality).toBe('medium');
      expect(result.learningType).toBe('pattern');
    });

    it('should score low quality for excessive iterations', () => {
      const context: LearningContext = {
        conversationId: 'conv-6',
        userId: 'user-1',
        task: 'Generate report',
        result: 'Report generated',
        turnCount: 8,
        toolCallCount: 4,
        hadErrors: false,
        recovered: false,
        duration: 20000,
      };

      const result = triggers.evaluate(context);

      // Too many turns -> low score (3), below learning threshold
      expect(result.score).toBe(3);
      expect(result.shouldLearn).toBe(false);
    });
  });

  describe('scoreTurnCount', () => {
    it('should give high score for 1-3 turns', () => {
      const context: LearningContext = {
        conversationId: 'conv-1',
        userId: 'user-1',
        task: 'Test',
        result: 'Done',
        turnCount: 2,
        toolCallCount: 0,
        hadErrors: false,
        recovered: false,
        duration: 1000,
      };

      const result = triggers.evaluate(context);
      // Turn score should be 3, total should be at least 3
      expect(result.score).toBeGreaterThanOrEqual(3);
    });
  });

  describe('scoreToolCount', () => {
    it('should give high score for 2-5 tools', () => {
      const context: LearningContext = {
        conversationId: 'conv-1',
        userId: 'user-1',
        task: 'Test',
        result: 'Done',
        turnCount: 1,
        toolCallCount: 3,
        hadErrors: false,
        recovered: false,
        duration: 1000,
      };

      const result = triggers.evaluate(context);
      // Tool score should be 3
      expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it('should give low score for no tools', () => {
      const context: LearningContext = {
        conversationId: 'conv-1',
        userId: 'user-1',
        task: 'Test',
        result: 'Done',
        turnCount: 1,
        toolCallCount: 0,
        hadErrors: false,
        recovered: false,
        duration: 1000,
      };

      const result = triggers.evaluate(context);
      // No tools -> score 3, below learning threshold
      expect(result.score).toBe(3);
      expect(result.shouldLearn).toBe(false);
    });
  });

  describe('scoreRecovery', () => {
    it('should give highest score for successful error recovery', () => {
      const context: LearningContext = {
        conversationId: 'conv-1',
        userId: 'user-1',
        task: 'Test',
        result: 'Done',
        turnCount: 2,
        toolCallCount: 2,
        hadErrors: true,
        recovered: true,
        duration: 1000,
      };

      const result = triggers.evaluate(context);
      // Recovery score should be 2
      expect(result.shouldLearn).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('should update scoring configuration', () => {
      triggers.updateConfig({
        minLearningScore: 4,
        highQualityThreshold: 6,
      });

      const config = triggers.getConfig();
      expect(config.minLearningScore).toBe(4);
      expect(config.highQualityThreshold).toBe(6);
    });
  });
});
