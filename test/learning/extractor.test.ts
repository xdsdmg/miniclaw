/**
 * Knowledge Extractor Tests
 */

import { KnowledgeExtractor, ExtractionContext } from '../../src/learning/extractor.js';
import { LLMProvider } from '../../src/llm.js';
import { MemoryStorage } from '../../src/memory/storage.js';
import { unlinkSync } from 'fs';
import { join } from 'path';

// Mock LLM Provider
class MockLLMProvider extends LLMProvider {
  constructor() {
    super({
      provider: 'test',
      apiKey: 'test-key',
    });
  }

  async generateResponse(_messages: any[], _tools: any[]) {
    return {
      content: JSON.stringify({
        title: 'Test Skill',
        description: 'A test skill for unit testing',
      }),
      model: 'test-model',
      toolCalls: [],
    };
  }
}

describe('KnowledgeExtractor', () => {
  const testDbPath = join(__dirname, 'test-extraction.db');
  let extractor: KnowledgeExtractor;
  let memoryStorage: MemoryStorage;
  let mockLLM: MockLLMProvider;

  beforeEach(() => {
    memoryStorage = new MemoryStorage(testDbPath);
    mockLLM = new MockLLMProvider();
    extractor = new KnowledgeExtractor(mockLLM, memoryStorage);
  });

  afterEach(() => {
    try {
      unlinkSync(testDbPath);
      try { unlinkSync(testDbPath + '-wal'); } catch {}
      try { unlinkSync(testDbPath + '-shm'); } catch {}
    } catch {
      // File might not exist
    }
  });

  describe('extract', () => {
    it('should extract skill from multi-tool conversation', async () => {
      const conversationId = 'test-conv-1';
      memoryStorage.createConversation({
        id: conversationId,
        userId: 'user-1',
        startTime: Date.now(),
        status: 'completed',
      });

      memoryStorage.saveToolExecution({
        id: 'tool-1',
        conversationId,
        timestamp: Date.now(),
        toolName: 'bash',
        toolArguments: { command: 'ls' },
        executionResult: 'file1.txt\nfile2.txt',
        executionTimeMs: 100,
        success: true,
      });

      memoryStorage.saveToolExecution({
        id: 'tool-2',
        conversationId,
        timestamp: Date.now(),
        toolName: 'bash',
        toolArguments: { command: 'cat file1.txt' },
        executionResult: 'Hello World',
        executionTimeMs: 50,
        success: true,
      });

      const context: ExtractionContext = {
        conversationId,
        userId: 'user-1',
        task: 'List and read files',
        result: 'Files listed and content read',
        turnCount: 2,
        success: true,
      };

      const knowledge = await extractor.extract(context);

      expect(knowledge).toHaveLength(1);
      expect(knowledge[0].type).toBe('skill');
      expect(knowledge[0].toolSequence).toHaveLength(2);
    });

    it('should extract pattern from single-tool conversation', async () => {
      const conversationId = 'test-conv-2';
      memoryStorage.createConversation({
        id: conversationId,
        userId: 'user-1',
        startTime: Date.now(),
        status: 'completed',
      });

      memoryStorage.saveToolExecution({
        id: 'tool-3',
        conversationId,
        timestamp: Date.now(),
        toolName: 'bash',
        toolArguments: { command: 'npm test' },
        executionResult: 'Tests passed',
        executionTimeMs: 5000,
        success: true,
      });

      const context: ExtractionContext = {
        conversationId,
        userId: 'user-1',
        task: 'Run tests',
        result: 'All tests passed',
        turnCount: 1,
        success: true,
      };

      const knowledge = await extractor.extract(context);

      expect(knowledge).toHaveLength(1);
      expect(knowledge[0].type).toBe('pattern');
    });

    it('should extract fact from conversation with no tools', async () => {
      const conversationId = 'test-conv-3';
      memoryStorage.createConversation({
        id: conversationId,
        userId: 'user-1',
        startTime: Date.now(),
        status: 'completed',
      });

      const context: ExtractionContext = {
        conversationId,
        userId: 'user-1',
        task: 'What is the capital of France?',
        result: 'Paris',
        turnCount: 1,
        success: true,
      };

      const knowledge = await extractor.extract(context);

      expect(knowledge).toHaveLength(1);
      expect(knowledge[0].type).toBe('fact');
      expect(knowledge[0].toolSequence).toHaveLength(0);
    });
  });

  describe('calculateConfidence', () => {
    it('should give higher confidence for successful execution', async () => {
      const conversationId = 'test-conv-4';
      memoryStorage.createConversation({
        id: conversationId,
        userId: 'user-1',
        startTime: Date.now(),
        status: 'completed',
      });

      memoryStorage.saveToolExecution({
        id: 'tool-4',
        conversationId,
        timestamp: Date.now(),
        toolName: 'bash',
        toolArguments: { command: 'test' },
        executionResult: 'Success',
        executionTimeMs: 100,
        success: true,
      });

      memoryStorage.saveToolExecution({
        id: 'tool-5',
        conversationId,
        timestamp: Date.now(),
        toolName: 'bash',
        toolArguments: { command: 'test2' },
        executionResult: 'Success',
        executionTimeMs: 100,
        success: true,
      });

      const context: ExtractionContext = {
        conversationId,
        userId: 'user-1',
        task: 'Test',
        result: 'Success',
        turnCount: 2,
        success: true,
      };

      const knowledge = await extractor.extract(context);
      expect(knowledge[0].confidence).toBeGreaterThan(0.7);
    });
  });
});
