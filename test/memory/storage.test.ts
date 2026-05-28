import { MemoryStorage, Conversation, LLMInteraction, ToolExecution } from '../../src/memory/storage.js';
import fs from 'fs';

describe('MemoryStorage', () => {
    const testDbPath = './test-storage.db';
    let storage: MemoryStorage;

    beforeEach(() => {
        // Clean up before each test
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

        storage = new MemoryStorage(testDbPath);
    });

    afterEach(() => {
        // Clean up after each test
        storage.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    });

    // ========================================================================
    // Conversation Operations Tests
    // ========================================================================

    describe('Conversation Operations', () => {
        it('should create a conversation (createConversation)', () => {
            const conversation: Conversation = {
                id: 'test-conv-1',
                userId: 'user-123',
                startTime: Date.now(),
                status: 'active'
            };

            storage.createConversation(conversation);

            const conv = storage.getConversation('test-conv-1');
            expect(conv).toBeDefined();
            expect(conv?.id).toBe('test-conv-1');
            expect(conv?.userId).toBe('user-123');
            expect(conv?.status).toBe('active');
        });

        it('should create conversation with optional fields', () => {
            const conversation: Conversation = {
                id: 'test-conv-2',
                userId: 'user-456',
                startTime: Date.now(),
                status: 'active',
                metadata: { source: 'cli', tags: ['test'] },
                compressed: 'some compressed data'
            };

            storage.createConversation(conversation);

            const conv = storage.getConversation('test-conv-2');
            expect(conv?.metadata).toEqual({ source: 'cli', tags: ['test'] });
            expect(conv?.compressed).toBe('some compressed data');
        });

        it('should get conversation by id (getConversation)', () => {
            storage.createConversation({
                id: 'test-conv-3',
                userId: 'user-789',
                startTime: Date.now(),
                status: 'completed'
            });

            const conv = storage.getConversation('test-conv-3');
            expect(conv).toBeDefined();
            expect(conv?.id).toBe('test-conv-3');
        });

        it('should return null for non-existent conversation (getConversation)', () => {
            const conv = storage.getConversation('non-existent');
            expect(conv).toBeNull();
        });

        it('should update conversation status and endTime (updateConversation)', () => {
            storage.createConversation({
                id: 'test-conv-4',
                userId: 'user-999',
                startTime: Date.now(),
                status: 'active'
            });

            const endTime = Date.now();
            storage.updateConversation('test-conv-4', {
                status: 'completed',
                endTime: endTime
            });

            const conv = storage.getConversation('test-conv-4');
            expect(conv?.status).toBe('completed');
            expect(conv?.endTime).toBe(endTime);
        });

        it('should update conversation metadata (updateConversation)', () => {
            storage.createConversation({
                id: 'test-conv-5',
                userId: 'user-meta',
                startTime: Date.now(),
                status: 'active',
                metadata: { old: 'data' }
            });

            storage.updateConversation('test-conv-5', {
                metadata: { new: 'metadata', version: 2 }
            });

            const conv = storage.getConversation('test-conv-5');
            expect(conv?.metadata).toEqual({ new: 'metadata', version: 2 });
        });

        it('should update conversation compressed field (updateConversation)', () => {
            storage.createConversation({
                id: 'test-conv-6',
                userId: 'user-compress',
                startTime: Date.now(),
                status: 'active'
            });

            storage.updateConversation('test-conv-6', {
                compressed: 'compressed context data'
            });

            const conv = storage.getConversation('test-conv-6');
            expect(conv?.compressed).toBe('compressed context data');
        });

        it('should handle empty update (updateConversation with no changes)', () => {
            storage.createConversation({
                id: 'test-conv-7',
                userId: 'user-empty',
                startTime: Date.now(),
                status: 'active'
            });

            // Should not throw, should do nothing
            storage.updateConversation('test-conv-7', {});

            const conv = storage.getConversation('test-conv-7');
            expect(conv?.status).toBe('active');
        });

        it('should list all conversations (listConversations)', () => {
            storage.createConversation({
                id: 'conv-1',
                userId: 'user-list',
                startTime: Date.now() - 1000,
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-2',
                userId: 'user-list',
                startTime: Date.now(),
                status: 'completed'
            });

            const conversations = storage.listConversations();
            expect(conversations.length).toBe(2);
            expect(conversations[0].id).toBe('conv-2'); // Most recent first (DESC order)
        });

        it('should filter conversations by userId (listConversations with filter)', () => {
            storage.createConversation({
                id: 'conv-user-a',
                userId: 'user-a',
                startTime: Date.now(),
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-user-b',
                userId: 'user-b',
                startTime: Date.now(),
                status: 'active'
            });

            const userAConvs = storage.listConversations({ userId: 'user-a' });
            expect(userAConvs.length).toBe(1);
            expect(userAConvs[0].userId).toBe('user-a');
        });

        it('should filter conversations by status (listConversations with filter)', () => {
            storage.createConversation({
                id: 'conv-active',
                userId: 'user-filter',
                startTime: Date.now(),
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-completed',
                userId: 'user-filter',
                startTime: Date.now(),
                status: 'completed'
            });

            storage.createConversation({
                id: 'conv-error',
                userId: 'user-filter',
                startTime: Date.now(),
                status: 'error'
            });

            const activeConvs = storage.listConversations({ status: 'active' });
            expect(activeConvs.length).toBe(1);
            expect(activeConvs[0].status).toBe('active');
        });

        it('should filter conversations by time range (listConversations with filter)', () => {
            const now = Date.now();
            const oldTime = now - 100000;

            storage.createConversation({
                id: 'conv-old',
                userId: 'user-time',
                startTime: oldTime,
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-new',
                userId: 'user-time',
                startTime: now,
                status: 'active'
            });

            const recentConvs = storage.listConversations({
                startTime: now - 50000 // Only include conv-new
            });

            expect(recentConvs.length).toBe(1);
            expect(recentConvs[0].id).toBe('conv-new');
        });

        it('should limit conversation list (listConversations with limit)', () => {
            for (let i = 1; i <= 5; i++) {
                storage.createConversation({
                    id: `conv-limit-${i}`,
                    userId: 'user-limit',
                    startTime: Date.now() + i,
                    status: 'active'
                });
            }

            const limited = storage.listConversations({ limit: 3 });
            expect(limited.length).toBe(3);
        });

        it('should combine multiple filters (listConversations with complex filter)', () => {
            const now = Date.now();

            storage.createConversation({
                id: 'conv-combo-1',
                userId: 'user-combo',
                startTime: now,
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-combo-2',
                userId: 'user-other',
                startTime: now,
                status: 'active'
            });

            storage.createConversation({
                id: 'conv-combo-3',
                userId: 'user-combo',
                startTime: now,
                status: 'completed'
            });

            const filtered = storage.listConversations({
                userId: 'user-combo',
                status: 'active'
            });

            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe('conv-combo-1');
        });
    });

    // ========================================================================
    // LLM Interaction Operations Tests
    // ========================================================================

    describe('LLM Interaction Operations', () => {
        beforeEach(() => {
            // Create a test conversation for each test
            storage.createConversation({
                id: 'test-conv-llm',
                userId: 'user-llm',
                startTime: Date.now(),
                status: 'active'
            });
        });

        it('should save LLM interaction (saveLLMInteraction)', () => {
            const interaction: LLMInteraction = {
                id: 'llm-1',
                conversationId: 'test-conv-llm',
                timestamp: Date.now(),
                requestPrompt: 'Test prompt',
                responseText: 'Test response',
                modelName: 'gpt-4',
                cached: false
            };

            storage.saveLLMInteraction(interaction);

            const interactions = storage.getLLMInteractions('test-conv-llm');
            expect(interactions.length).toBe(1);
            expect(interactions[0].requestPrompt).toBe('Test prompt');
        });

        it('should save LLM interaction with optional fields (saveLLMInteraction)', () => {
            const interaction: LLMInteraction = {
                id: 'llm-2',
                conversationId: 'test-conv-llm',
                timestamp: Date.now(),
                requestPrompt: 'Complex prompt',
                responseText: 'Complex response',
                modelName: 'claude-3',
                tokensUsed: 150,
                cached: true,
                lineage: ['msg-1', 'msg-2', 'msg-3']
            };

            storage.saveLLMInteraction(interaction);

            const interactions = storage.getLLMInteractions('test-conv-llm');
            expect(interactions[0].tokensUsed).toBe(150);
            expect(interactions[0].cached).toBe(true);
            expect(interactions[0].lineage).toEqual(['msg-1', 'msg-2', 'msg-3']);
        });

        it('should get LLM interactions for a conversation (getLLMInteractions)', () => {
            storage.saveLLMInteraction({
                id: 'llm-3',
                conversationId: 'test-conv-llm',
                timestamp: Date.now() - 2000,
                requestPrompt: 'First prompt',
                responseText: 'First response',
                modelName: 'gpt-4',
                cached: false
            });

            storage.saveLLMInteraction({
                id: 'llm-4',
                conversationId: 'test-conv-llm',
                timestamp: Date.now() - 1000,
                requestPrompt: 'Second prompt',
                responseText: 'Second response',
                modelName: 'gpt-4',
                cached: false
            });

            const interactions = storage.getLLMInteractions('test-conv-llm');
            expect(interactions.length).toBe(2);
            expect(interactions[0].requestPrompt).toBe('First prompt'); // ASC order by timestamp
            expect(interactions[1].requestPrompt).toBe('Second prompt');
        });

        it('should return empty array for conversation with no interactions (getLLMInteractions)', () => {
            storage.createConversation({
                id: 'empty-conv',
                userId: 'user-empty',
                startTime: Date.now(),
                status: 'active'
            });

            const interactions = storage.getLLMInteractions('empty-conv');
            expect(interactions).toEqual([]);
        });
    });

    // ========================================================================
    // FTS5 Full-Text Search Tests
    // ========================================================================

    describe('FTS5 Full-Text Search', () => {
        beforeEach(() => {
            storage.createConversation({
                id: 'test-conv-search',
                userId: 'user-search',
                startTime: Date.now(),
                status: 'active'
            });
        });

        it('should perform FTS5 search with single word (fts5Search)', () => {
            storage.saveLLMInteraction({
                id: 'llm-search-1',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'What is the weather in Beijing?',
                responseText: 'Beijing weather is sunny and 25°C.',
                modelName: 'gpt-4',
                cached: false
            });

            const results = storage.fts5Search('Beijing', 5);
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].snippet).toContain('Beijing');
        });

        it('should perform FTS5 search with multiple words (fts5Search)', () => {
            storage.saveLLMInteraction({
                id: 'llm-search-2',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'How do I debug authentication errors?',
                responseText: 'To debug authentication, check the token and verify credentials.',
                modelName: 'gpt-4',
                cached: false
            });

            const results = storage.fts5Search('authentication debug', 5);
            expect(results.length).toBeGreaterThan(0);
        });

        it('should return ranked results with BM25 (fts5Search)', () => {
            storage.saveLLMInteraction({
                id: 'llm-search-3',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'Python API tutorial',
                responseText: 'Learn Python API development',
                modelName: 'gpt-4',
                cached: false
            });

            storage.saveLLMInteraction({
                id: 'llm-search-4',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'Python Python Python advanced', // More matches
                responseText: 'Python Python Python Python', // Higher BM25 score
                modelName: 'gpt-4',
                cached: false
            });

            const results = storage.fts5Search('Python', 10);
            expect(results.length).toBeGreaterThan(0);
            // Results should be ranked by BM25 (lower score = better match)
            expect(results[0].rank).toBeDefined();
            expect(typeof results[0].rank).toBe('number');
        });

        it('should respect limit parameter (fts5Search)', () => {
            for (let i = 0; i < 5; i++) {
                storage.saveLLMInteraction({
                    id: `llm-limit-${i}`,
                    conversationId: 'test-conv-search',
                    timestamp: Date.now(),
                    requestPrompt: `Test message ${i}`,
                    responseText: `Test response ${i}`,
                    modelName: 'gpt-4',
                    cached: false
                });
            }

            const results = storage.fts5Search('Test', 3);
            expect(results.length).toBe(3);
        });

        it('should return empty array for no matches (fts5Search)', () => {
            storage.saveLLMInteraction({
                id: 'llm-nomatch',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'Completely different topic',
                responseText: 'Nothing related here',
                modelName: 'gpt-4',
                cached: false
            });

            const results = storage.fts5Search('nonexistentword12345', 10);
            expect(results).toEqual([]);
        });

        it('should include interaction data in search results (fts5Search)', () => {
            storage.saveLLMInteraction({
                id: 'llm-data-check',
                conversationId: 'test-conv-search',
                timestamp: Date.now(),
                requestPrompt: 'Check data integrity',
                responseText: 'Data is valid',
                modelName: 'claude-3',
                tokensUsed: 200,
                cached: true
            });

            const results = storage.fts5Search('data', 10);
            expect(results[0].interaction.id).toBe('llm-data-check');
            expect(results[0].interaction.modelName).toBe('claude-3');
            expect(results[0].interaction.tokensUsed).toBe(200);
            expect(results[0].interaction.cached).toBe(true);
        });
    });

    // ========================================================================
    // Tool Execution Operations Tests
    // ========================================================================

    describe('Tool Execution Operations', () => {
        beforeEach(() => {
            storage.createConversation({
                id: 'test-conv-tools',
                userId: 'user-tools',
                startTime: Date.now(),
                status: 'active'
            });
        });

        it('should save tool execution (saveToolExecution)', () => {
            const execution: ToolExecution = {
                id: 'tool-1',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                toolName: 'Read',
                toolArguments: { file_path: '/path/to/file.txt' },
                executionResult: 'File content here',
                executionTimeMs: 100,
                success: true
            };

            storage.saveToolExecution(execution);

            const executions = storage.getToolExecutions('test-conv-tools');
            expect(executions.length).toBe(1);
            expect(executions[0].toolName).toBe('Read');
        });

        it('should save tool execution with all fields (saveToolExecution)', () => {
            // First create the LLM interaction that tool execution references
            storage.saveLLMInteraction({
                id: 'llm-int-1',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                requestPrompt: 'Execute command',
                responseText: 'I will run ls -la',
                modelName: 'gpt-4',
                cached: false
            });

            const execution: ToolExecution = {
                id: 'tool-2',
                conversationId: 'test-conv-tools',
                llmInteractionId: 'llm-int-1',
                timestamp: Date.now(),
                toolName: 'Bash',
                toolArguments: { command: 'ls -la', timeout: 5000 },
                executionResult: 'Files listed successfully',
                executionTimeMs: 250,
                success: true,
                errorMessage: undefined
            };

            storage.saveToolExecution(execution);

            const executions = storage.getToolExecutions('test-conv-tools');
            expect(executions[0].llmInteractionId).toBe('llm-int-1');
            expect(executions[0].toolArguments).toEqual({ command: 'ls -la', timeout: 5000 });
        });

        it('should save failed tool execution (saveToolExecution)', () => {
            const execution: ToolExecution = {
                id: 'tool-3',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                toolName: 'Write',
                toolArguments: { file_path: '/readonly/file.txt', content: 'test' },
                executionResult: '',
                executionTimeMs: 50,
                success: false,
                errorMessage: 'Permission denied'
            };

            storage.saveToolExecution(execution);

            const executions = storage.getToolExecutions('test-conv-tools');
            expect(executions[0].success).toBe(false);
            expect(executions[0].errorMessage).toBe('Permission denied');
        });

        it('should get tool executions for conversation (getToolExecutions)', () => {
            storage.saveToolExecution({
                id: 'tool-4',
                conversationId: 'test-conv-tools',
                timestamp: Date.now() - 3000,
                toolName: 'Read',
                toolArguments: { path: 'file1.txt' },
                executionResult: 'Content 1',
                executionTimeMs: 100,
                success: true
            });

            storage.saveToolExecution({
                id: 'tool-5',
                conversationId: 'test-conv-tools',
                timestamp: Date.now() - 2000,
                toolName: 'Bash',
                toolArguments: { command: 'echo test' },
                executionResult: 'test',
                executionTimeMs: 50,
                success: true
            });

            const executions = storage.getToolExecutions('test-conv-tools');
            expect(executions.length).toBe(2);
            expect(executions[0].toolName).toBe('Read'); // ASC order by timestamp
            expect(executions[1].toolName).toBe('Bash');
        });

        it('should return empty array for conversation with no tool executions (getToolExecutions)', () => {
            storage.createConversation({
                id: 'empty-tool-conv',
                userId: 'user-empty-tool',
                startTime: Date.now(),
                status: 'active'
            });

            const executions = storage.getToolExecutions('empty-tool-conv');
            expect(executions).toEqual([]);
        });

        it('should search tool executions by name (searchToolExecutions)', () => {
            storage.saveToolExecution({
                id: 'tool-search-1',
                conversationId: 'test-conv-tools',
                timestamp: Date.now() - 2000,
                toolName: 'Read',
                toolArguments: { path: 'file1.txt' },
                executionResult: 'Content 1',
                executionTimeMs: 100,
                success: true
            });

            storage.saveToolExecution({
                id: 'tool-search-2',
                conversationId: 'test-conv-tools',
                timestamp: Date.now() - 1000,
                toolName: 'Read',
                toolArguments: { path: 'file2.txt' },
                executionResult: 'Content 2',
                executionTimeMs: 150,
                success: true
            });

            storage.saveToolExecution({
                id: 'tool-search-3',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                toolName: 'Bash',
                toolArguments: { command: 'test' },
                executionResult: 'Output',
                executionTimeMs: 50,
                success: true
            });

            const readExecutions = storage.searchToolExecutions('Read');
            expect(readExecutions.length).toBe(2);
            expect(readExecutions[0].toolName).toBe('Read');
            expect(readExecutions[1].toolName).toBe('Read');
        });

        it('should search tool executions with limit (searchToolExecutions)', () => {
            for (let i = 0; i < 5; i++) {
                storage.saveToolExecution({
                    id: `tool-limit-${i}`,
                    conversationId: 'test-conv-tools',
                    timestamp: Date.now() + i,
                    toolName: 'Read',
                    toolArguments: { path: `file${i}.txt` },
                    executionResult: `Content ${i}`,
                    executionTimeMs: 100,
                    success: true
                });
            }

            const results = storage.searchToolExecutions('Read', 3);
            expect(results.length).toBe(3);
        });

        it('should return most recent first in search (searchToolExecutions)', () => {
            storage.saveToolExecution({
                id: 'tool-recent-1',
                conversationId: 'test-conv-tools',
                timestamp: Date.now() - 2000,
                toolName: 'Bash',
                toolArguments: { command: 'old' },
                executionResult: 'Old output',
                executionTimeMs: 100,
                success: true
            });

            storage.saveToolExecution({
                id: 'tool-recent-2',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                toolName: 'Bash',
                toolArguments: { command: 'new' },
                executionResult: 'New output',
                executionTimeMs: 100,
                success: true
            });

            const results = storage.searchToolExecutions('Bash');
            expect(results[0].id).toBe('tool-recent-2'); // DESC order by timestamp
            expect(results[0].toolArguments.command).toBe('new');
        });

        it('should return empty array for non-existent tool name (searchToolExecutions)', () => {
            storage.saveToolExecution({
                id: 'tool-notfound',
                conversationId: 'test-conv-tools',
                timestamp: Date.now(),
                toolName: 'Read',
                toolArguments: { path: 'file.txt' },
                executionResult: 'Content',
                executionTimeMs: 100,
                success: true
            });

            const results = storage.searchToolExecutions('NonExistentTool');
            expect(results).toEqual([]);
        });
    });

    // ========================================================================
    // Utility Methods Tests
    // ========================================================================

    describe('Utility Methods', () => {
        it('should close database connection (close)', () => {
            storage.createConversation({
                id: 'test-close',
                userId: 'user-close',
                startTime: Date.now(),
                status: 'active'
            });

            // Should not throw
            expect(() => storage.close()).not.toThrow();
        });

        it('should handle operations after close gracefully', () => {
            storage.close();

            // Operations after close should either throw or handle gracefully
            expect(() => {
                storage.createConversation({
                    id: 'test-after-close',
                    userId: 'user-after-close',
                    startTime: Date.now(),
                    status: 'active'
                });
            }).toThrow();
        });
    });

    // ========================================================================
    // Integration Tests
    // ========================================================================

    describe('Integration Tests', () => {
        it('should handle complete conversation workflow', () => {
            // 1. Create conversation
            storage.createConversation({
                id: 'integration-conv',
                userId: 'user-integration',
                startTime: Date.now(),
                status: 'active'
            });

            // 2. Save LLM interactions
            storage.saveLLMInteraction({
                id: 'integration-llm-1',
                conversationId: 'integration-conv',
                timestamp: Date.now(),
                requestPrompt: 'List files in current directory',
                responseText: 'I will use the Read tool to list files.',
                modelName: 'gpt-4',
                cached: false
            });

            // 3. Save tool executions
            storage.saveToolExecution({
                id: 'integration-tool-1',
                conversationId: 'integration-conv',
                llmInteractionId: 'integration-llm-1',
                timestamp: Date.now(),
                toolName: 'Bash',
                toolArguments: { command: 'ls' },
                executionResult: 'file1.txt\nfile2.txt',
                executionTimeMs: 150,
                success: true
            });

            // 4. Save second LLM interaction
            storage.saveLLMInteraction({
                id: 'integration-llm-2',
                conversationId: 'integration-conv',
                timestamp: Date.now(),
                requestPrompt: 'What files were found?',
                responseText: 'Found file1.txt and file2.txt',
                modelName: 'gpt-4',
                cached: false
            });

            // 5. Update conversation to completed
            storage.updateConversation('integration-conv', {
                status: 'completed',
                endTime: Date.now()
            });

            // 6. Verify all data
            const conv = storage.getConversation('integration-conv');
            expect(conv?.status).toBe('completed');

            const llmInteractions = storage.getLLMInteractions('integration-conv');
            expect(llmInteractions.length).toBe(2);

            const toolExecutions = storage.getToolExecutions('integration-conv');
            expect(toolExecutions.length).toBe(1);
            expect(toolExecutions[0].toolName).toBe('Bash');

            // 7. Verify FTS search works
            const searchResults = storage.fts5Search('files', 10);
            expect(searchResults.length).toBeGreaterThan(0);
        });

        it('should handle multiple conversations independently', () => {
            // Create multiple conversations
            storage.createConversation({
                id: 'multi-conv-1',
                userId: 'user-multi-1',
                startTime: Date.now(),
                status: 'active'
            });

            storage.createConversation({
                id: 'multi-conv-2',
                userId: 'user-multi-2',
                startTime: Date.now(),
                status: 'active'
            });

            // Add interactions to each
            storage.saveLLMInteraction({
                id: 'multi-llm-1',
                conversationId: 'multi-conv-1',
                timestamp: Date.now(),
                requestPrompt: 'User 1 prompt',
                responseText: 'User 1 response',
                modelName: 'gpt-4',
                cached: false
            });

            storage.saveLLMInteraction({
                id: 'multi-llm-2',
                conversationId: 'multi-conv-2',
                timestamp: Date.now(),
                requestPrompt: 'User 2 prompt',
                responseText: 'User 2 response',
                modelName: 'gpt-4',
                cached: false
            });

            // Verify isolation
            const conv1Interactions = storage.getLLMInteractions('multi-conv-1');
            const conv2Interactions = storage.getLLMInteractions('multi-conv-2');

            expect(conv1Interactions.length).toBe(1);
            expect(conv2Interactions.length).toBe(1);
            expect(conv1Interactions[0].requestPrompt).toBe('User 1 prompt');
            expect(conv2Interactions[0].requestPrompt).toBe('User 2 prompt');
        });
    });
});
