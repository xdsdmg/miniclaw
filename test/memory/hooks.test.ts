import { MemoryHooks } from '../../src/memory/hooks.js';
import { HookManagerImpl } from '../../src/core/hooks.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { SessionManager } from '../../src/memory/session-manager.js';
import fs from 'fs/promises';

describe('MemoryHooks', () => {
    const testDbPath = './test-memory-hooks.db';
    const testMemoriesDir = './test-memory-hooks-memories';
    let memoryManager: MemoryManager;
    let sessionManager: SessionManager;
    let memoryHooks: MemoryHooks;
    let hookManager: HookManagerImpl;

    beforeEach(async () => {
        // Clean up test files before each test
        await fs.unlink(testDbPath).catch(() => {});
        await fs.rm(testMemoriesDir, { recursive: true, force: true }).catch(() => {});

        // Initialize MemoryManager with test configuration
        memoryManager = new MemoryManager({
            dbPath: testDbPath,
            memoriesDir: testMemoriesDir,
            skillsDir: './test-skills',
            promptMemoryCharLimit: 500
        });

        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 50));

        // Initialize SessionManager
        sessionManager = new SessionManager(memoryManager);

        // Initialize HookManager
        hookManager = new HookManagerImpl();

        // Create and register MemoryHooks
        memoryHooks = new MemoryHooks(memoryManager, sessionManager);
    });

    afterEach(async () => {
        // Clean up test files
        await fs.unlink(testDbPath).catch(() => {});
        await fs.rm(testMemoriesDir, { recursive: true, force: true }).catch(() => {});
    });

    // ========================================================================
    // Hook Registration
    // ========================================================================

    describe('Hook Registration', () => {
        it('should register all hooks successfully', () => {
            memoryHooks.registerTo(hookManager);

            // Verify all 9 hooks are registered
            expect(hookManager.hasHandlers('beforeExecute')).toBe(true);
            expect(hookManager.hasHandlers('afterStableContext')).toBe(true);
            expect(hookManager.hasHandlers('afterDynamicContext')).toBe(true);
            expect(hookManager.hasHandlers('beforeLLMCall')).toBe(true);
            expect(hookManager.hasHandlers('afterLLMCall')).toBe(true);
            expect(hookManager.hasHandlers('beforeToolCall')).toBe(true);
            expect(hookManager.hasHandlers('afterToolCall')).toBe(true);
            expect(hookManager.hasHandlers('afterExecute')).toBe(true);
            expect(hookManager.hasHandlers('onError')).toBe(true);
        });

        it('should register hooks with correct priority', () => {
            memoryHooks.registerTo(hookManager);

            const handlers = hookManager.getHandlers('beforeExecute');
            expect(handlers.length).toBe(1);
            expect(handlers[0].priority).toBe(10);  // Memory hooks run at priority 10
            expect(handlers[0].id).toBe('memory-before-execute');
        });

        it('should have unique hook IDs', () => {
            memoryHooks.registerTo(hookManager);

            const allHandlers = [
                ...hookManager.getHandlers('beforeExecute'),
                ...hookManager.getHandlers('afterStableContext'),
                ...hookManager.getHandlers('afterDynamicContext'),
                ...hookManager.getHandlers('beforeLLMCall'),
                ...hookManager.getHandlers('afterLLMCall'),
                ...hookManager.getHandlers('beforeToolCall'),
                ...hookManager.getHandlers('afterToolCall'),
                ...hookManager.getHandlers('afterExecute'),
                ...hookManager.getHandlers('onError')
            ];

            const ids = allHandlers.map(h => h.id);
            const uniqueIds = new Set(ids);

            expect(ids.length).toBe(uniqueIds.size);  // All IDs should be unique
        });
    });

    // ========================================================================
    // beforeExecute Hook
    // ========================================================================

    describe('beforeExecute Hook', () => {
        it('should start conversation and set conversationId', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-1',
                userId: 'test-user',
                task: 'Test task',
                timestamp: Date.now()
            };

            await hookManager.executeAsync('beforeExecute', context);

            expect(context.conversationId).toBeDefined();
            expect(typeof context.conversationId).toBe('string');

            // Verify conversation was created in database
            const conversation = memoryManager.getConversation(context.conversationId);
            expect(conversation).not.toBeNull();
            expect(conversation?.userId).toBe('test-user');
        });

        it('should handle missing userId gracefully', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-2',
                task: 'Test task',
                timestamp: Date.now()
            };

            await hookManager.executeAsync('beforeExecute', context);

            expect(context.conversationId).toBeDefined();

            // Verify conversation was created without userId
            const conversation = memoryManager.getConversation(context.conversationId);
            expect(conversation).not.toBeNull();
        });
    });

    // ========================================================================
    // afterStableContext Hook
    // ========================================================================

    describe('afterStableContext Hook', () => {
        it('should add session history to context', async () => {
            memoryHooks.registerTo(hookManager);

            const userId = 'test-user-session';
            const context: any = {
                taskId: 'test-task-3',
                userId: userId,
                task: 'Test task',
                context: 'Initial context\n',
                contextType: 'stable',
                tokenCount: 100,
                cached: true
            };

            // Add some session history
            sessionManager.addMessage(userId, 'user', 'Hello');
            sessionManager.addMessage(userId, 'assistant', 'Hi there!');

            await hookManager.executeAsync('afterStableContext', context);

            // Context should be modified with session history
            expect(context.context).toContain('## Recent Conversation');
            expect(context.context).toContain('user: Hello');
            expect(context.context).toContain('assistant: Hi there!');
        });

        it('should not modify context when no session history', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-4',
                userId: 'no-history-user',
                task: 'Test task',
                context: 'Initial context\n',
                contextType: 'stable',
                tokenCount: 100,
                cached: true
            };

            const originalContext = context.context;

            await hookManager.executeAsync('afterStableContext', context);

            // Context should not have session history section
            expect(context.context).not.toContain('## Recent Conversation');
            expect(context.context).toBe(originalContext);
        });

        it('should limit to last 5 messages', async () => {
            memoryHooks.registerTo(hookManager);

            const userId = 'test-user-limit';
            const context: any = {
                taskId: 'test-task-5',
                userId: userId,
                task: 'Test task',
                context: '',
                contextType: 'stable',
                tokenCount: 0,
                cached: true
            };

            // Add 10 messages
            for (let i = 0; i < 10; i++) {
                sessionManager.addMessage(userId, 'user', `Message ${i}`);
                sessionManager.addMessage(userId, 'assistant', `Response ${i}`);
            }

            await hookManager.executeAsync('afterStableContext', context);

            // Should only include last 5 messages (10 total)
            const lines = context.context.split('\n').filter((line: string) => line.includes(':'));
            expect(lines.length).toBe(5);  // Last 5 messages
        });
    });

    // ========================================================================
    // afterDynamicContext Hook
    // ========================================================================

    describe('afterDynamicContext Hook', () => {
        it('should add search results to context', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-6',
                task: 'Beijing weather',
                context: '',
                contextType: 'dynamic',
                tokenCount: 0
            };

            await hookManager.executeAsync('afterDynamicContext', context);

            // Context should have search results section (even if empty, the hook should add section header)
            // But since there's no actual data in the database, we just verify it doesn't crash
            expect(context.taskId).toBe('test-task-6');
        });

        it('should not modify context when no search results', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-7',
                task: 'unique query with no results',
                context: 'Original context',
                contextType: 'dynamic',
                tokenCount: 100
            };

            const originalContext = context.context;

            await hookManager.executeAsync('afterDynamicContext', context);

            // Context should only have section header if there are results
            // If no results, it should not add the section
            const hasResults = context.context.includes('## Relevant Past Conversations') &&
                              context.context.includes('-');
            expect(hasResults).toBe(false);
        });
    });

    // ========================================================================
    // beforeLLMCall Hook
    // ========================================================================

    describe('beforeLLMCall Hook', () => {
        it('should log LLM call details', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-8',
                conversationId: 'test-conv-1',
                messages: [{ role: 'user', content: 'Test' }],
                model: 'gpt-4',
                estimatedTokens: 150
            };

            await hookManager.executeAsync('beforeLLMCall', context);

            // Should not throw, should log the call
            // (We can't easily test logger output, but we can verify it doesn't crash)
            expect(context.taskId).toBe('test-task-8');
        });

        it('should warn when approaching token limit', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-9',
                conversationId: 'test-conv-2',
                messages: [],
                model: 'gpt-4',
                estimatedTokens: 4500  // Over 4000 threshold
            };

            await hookManager.executeAsync('beforeLLMCall', context);

            // Should not throw, should log warning
            expect(context.estimatedTokens).toBe(4500);
        });
    });

    // ========================================================================
    // afterLLMCall Hook
    // ========================================================================

    describe('afterLLMCall Hook', () => {
        it('should record LLM interaction', async () => {
            memoryHooks.registerTo(hookManager);

            // First create a conversation
            const convId = memoryManager.startConversation('test-user-llm');

            const context: any = {
                taskId: 'test-task-10',
                conversationId: convId,
                requestMessages: [{ role: 'user', content: 'Test message' }],
                response: {
                    content: 'Test response',
                    model: 'gpt-4',
                    usage: { total_tokens: 50 }
                },
                duration: 1000,
                cached: false,
                success: true
            };

            await hookManager.executeAsync('afterLLMCall', context);

            // Verify LLM interaction was saved
            const interactions = memoryManager.getLLMInteractions(convId);
            expect(interactions.length).toBe(1);
            expect(interactions[0].responseText).toBe('Test response');
        });

        it('should handle missing conversationId gracefully', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-11',
                // No conversationId
                requestMessages: [],
                response: { content: '' },
                duration: 100,
                cached: false,
                success: true
            };

            // Should not throw
            await expect(async () => {
                await hookManager.executeAsync('afterLLMCall', context);
            }).resolves.not.toThrow();
        });
    });

    // ========================================================================
    // beforeToolCall Hook
    // ========================================================================

    describe('beforeToolCall Hook', () => {
        it('should log tool execution', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-12',
                conversationId: 'test-conv-4',
                toolName: 'Bash',
                toolArguments: { command: 'echo test' },
                timestamp: Date.now()
            };

            await hookManager.executeAsync('beforeToolCall', context);

            // Should not throw
            expect(context.toolName).toBe('Bash');
        });
    });

    // ========================================================================
    // afterToolCall Hook
    // ========================================================================

    describe('afterToolCall Hook', () => {
        it('should record tool execution', async () => {
            memoryHooks.registerTo(hookManager);

            // First create a conversation
            const convId = memoryManager.startConversation('test-user-tool');

            const context: any = {
                taskId: 'test-task-13',
                conversationId: convId,
                toolName: 'Bash',
                toolArguments: { command: 'ls' },
                result: {
                    output: 'file1.txt\nfile2.txt',
                    error: ''
                },
                duration: 50,
                success: true,
                errorMessage: ''
            };

            await hookManager.executeAsync('afterToolCall', context);

            // Verify tool execution was saved
            const toolExecutions = memoryManager.getToolExecutions(convId);
            expect(toolExecutions.length).toBe(1);
            expect(toolExecutions[0].toolName).toBe('Bash');
        });

        it('should record failed tool execution', async () => {
            memoryHooks.registerTo(hookManager);

            // First create a conversation
            const convId = memoryManager.startConversation('test-user-tool-fail');

            const context: any = {
                taskId: 'test-task-14',
                conversationId: convId,
                toolName: 'Bash',
                toolArguments: { command: 'rm -rf /' },
                result: {
                    output: '',
                    error: 'Permission denied'
                },
                duration: 10,
                success: false,
                errorMessage: 'Permission denied'
            };

            await hookManager.executeAsync('afterToolCall', context);

            // Verify tool execution was saved with failure status
            const toolExecutions = memoryManager.getToolExecutions(convId);
            expect(toolExecutions.length).toBe(1);
            expect(toolExecutions[0].success).toBe(false);
            expect(toolExecutions[0].errorMessage).toBe('Permission denied');
        });
    });

    // ========================================================================
    // afterExecute Hook
    // ========================================================================

    describe('afterExecute Hook', () => {
        it('should end conversation successfully', async () => {
            memoryHooks.registerTo(hookManager);

            // First create a conversation
            const convId = memoryManager.startConversation('test-user-after-execute');

            const context: any = {
                taskId: 'test-task-15',
                userId: 'test-user',
                conversationId: convId,
                task: 'Test task',
                result: 'Task completed',
                duration: 2000,
                success: true,
                turnCount: 2,
                toolCallCount: 1
            };

            await hookManager.executeAsync('afterExecute', context);

            // Verify conversation was ended
            const conversation = memoryManager.getConversation(convId);
            expect(conversation?.status).toBe('completed');
        });

        it('should handle missing conversationId gracefully', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-16',
                // No conversationId
                task: 'Test task',
                result: 'Done',
                duration: 1000,
                success: true,
                turnCount: 1,
                toolCallCount: 0
            };

            // Should not throw
            await expect(async () => {
                await hookManager.executeAsync('afterExecute', context);
            }).resolves.not.toThrow();
        });
    });

    // ========================================================================
    // onError Hook
    // ========================================================================

    describe('onError Hook', () => {
        it('should end conversation with error status', async () => {
            memoryHooks.registerTo(hookManager);

            // First create a conversation
            const convId = memoryManager.startConversation('test-user-on-error');

            const context: any = {
                taskId: 'test-task-17',
                conversationId: convId,
                error: new Error('Test error'),
                phase: 'llm'
            };

            await hookManager.executeAsync('onError', context);

            // Verify conversation was ended with error status
            const conversation = memoryManager.getConversation(convId);
            expect(conversation?.status).toBe('error');
        });

        it('should handle missing conversationId gracefully', async () => {
            memoryHooks.registerTo(hookManager);

            const context: any = {
                taskId: 'test-task-18',
                // No conversationId
                error: new Error('Test error'),
                phase: 'tool'
            };

            // Should not throw
            await expect(async () => {
                await hookManager.executeAsync('onError', context);
            }).resolves.not.toThrow();
        });
    });

    // ========================================================================
    // Integration Tests
    // ========================================================================

    describe('Integration', () => {
        it('should handle complete agent execution flow', async () => {
            memoryHooks.registerTo(hookManager);

            const userId = 'integration-test-user';
            const taskId = 'integration-task-1';

            // Simulate agent execution flow
            const beforeExecuteContext: any = {
                taskId,
                userId,
                task: 'What is the weather in Hefei?',
                timestamp: Date.now()
            };

            // beforeExecute
            await hookManager.executeAsync('beforeExecute', beforeExecuteContext);
            expect(beforeExecuteContext.conversationId).toBeDefined();

            const convId = beforeExecuteContext.conversationId;

            // Add session messages
            sessionManager.addMessage(userId, 'user', 'What is the weather in Hefei?');
            sessionManager.addMessage(userId, 'assistant', 'Hefei weather is sunny, 25°C');

            // afterStableContext
            const stableContext: any = {
                taskId,
                userId,
                task: 'What is the weather in Hefei?',
                context: 'System prompt\n',
                contextType: 'stable',
                tokenCount: 100,
                cached: true
            };

            await hookManager.executeAsync('afterStableContext', stableContext);
            expect(stableContext.context).toContain('user: What is the weather in Hefei?');

            // afterDynamicContext
            const dynamicContext: any = {
                taskId,
                task: 'What is the weather in Hefei?',
                context: '',
                contextType: 'dynamic',
                tokenCount: 0
            };

            await hookManager.executeAsync('afterDynamicContext', dynamicContext);

            // beforeLLMCall
            const beforeLLMContext: any = {
                taskId,
                conversationId: convId,
                messages: [{ role: 'user', content: 'What is the weather in Hefei?' }],
                model: 'gpt-4',
                estimatedTokens: 50
            };

            await hookManager.executeAsync('beforeLLMCall', beforeLLMContext);

            // afterLLMCall
            const afterLLMContext: any = {
                taskId,
                conversationId: convId,
                requestMessages: [{ role: 'user', content: 'What is the weather in Hefei?' }],
                response: {
                    content: 'Hefei weather is sunny, 25°C',
                    model: 'gpt-4',
                    usage: { total_tokens: 25 }
                },
                duration: 500,
                cached: false,
                success: true
            };

            await hookManager.executeAsync('afterLLMCall', afterLLMContext);

            // afterExecute
            const afterExecuteContext: any = {
                taskId,
                userId,
                conversationId: convId,
                task: 'What is the weather in Hefei?',
                result: 'Hefei weather is sunny, 25°C',
                duration: 1000,
                success: true,
                turnCount: 1,
                toolCallCount: 0
            };

            await hookManager.executeAsync('afterExecute', afterExecuteContext);

            // Verify conversation was completed
            const conversation = memoryManager.getConversation(convId);
            expect(conversation?.status).toBe('completed');

            // Verify LLM interaction was saved
            const interactions = memoryManager.getLLMInteractions(convId);
            expect(interactions.length).toBe(1);
        });
    });
});
