import { SessionManager } from '../../src/memory/session-manager.js';
import { MemoryManager } from '../../src/memory/manager.js';
import fs from 'fs/promises';

describe('Coreference Resolution Integration', () => {
    const testDbPath = './test-coreference.db';
    const testMemoriesDir = './test-coreference-memories';
    let memoryManager: MemoryManager;
    let sessionManager: SessionManager;

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
    });

    afterEach(async () => {
        // Clean up SessionManager
        sessionManager.destroy();

        // Clean up test files
        await fs.unlink(testDbPath).catch(() => {});
        await fs.rm(testMemoriesDir, { recursive: true, force: true }).catch(() => {});
    });

    // ========================================================================
    // Basic Coreference Resolution
    // ========================================================================

    describe('Basic Coreference Resolution', () => {
        it('should maintain context across messages', async () => {
            const userId = 'user-coreference-1';

            // Message 1: Ask about Hefei weather
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '今天合肥天气晴朗，温度 25°C');

            // Message 2: Coreference "那北京呢？"
            sessionManager.addMessage(userId, 'user', '那北京呢？');

            // Get session history
            const history = sessionManager.getSessionHistory(userId);

            // Should have all 3 messages
            expect(history.length).toBe(3);

            // Should contain context about Hefei weather
            const context = history.map(m => `${m.role}: ${m.content}`).join('\n');
            expect(context).toContain('合肥');
            expect(context).toContain('天气');
            expect(context).toContain('北京');
        });

        it('should preserve conversation order', () => {
            const userId = 'user-coreference-2';

            // Add multiple messages
            sessionManager.addMessage(userId, 'user', 'Message 1');
            sessionManager.addMessage(userId, 'assistant', 'Response 1');
            sessionManager.addMessage(userId, 'user', 'Message 2');
            sessionManager.addMessage(userId, 'assistant', 'Response 2');

            // Get history
            const history = sessionManager.getSessionHistory(userId);

            // Verify order
            expect(history[0].content).toBe('Message 1');
            expect(history[1].content).toBe('Response 1');
            expect(history[2].content).toBe('Message 2');
            expect(history[3].content).toBe('Response 2');
        });

        it('should handle coreference with multiple entities', () => {
            const userId = 'user-coreference-3';

            // Ask about multiple entities
            sessionManager.addMessage(userId, 'user', '合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '合肥天气晴朗，25°C');
            sessionManager.addMessage(userId, 'user', '那北京呢？');
            sessionManager.addMessage(userId, 'assistant', '北京天气多云，22°C');
            sessionManager.addMessage(userId, 'user', '上海呢？');

            // Get history
            const history = sessionManager.getSessionHistory(userId);

            // Should have all context
            expect(history.length).toBe(5);
            expect(history[4].content).toBe('上海呢？');

            // Context should include all cities
            const context = history.map(m => m.content).join(' ');
            expect(context).toContain('合肥');
            expect(context).toContain('北京');
            expect(context).toContain('上海');
        });
    });

    // ========================================================================
    // Session Isolation
    // ========================================================================

    describe('Session Isolation', () => {
        it('should maintain separate contexts for different users', () => {
            // User 1 asks about Hefei
            const user1 = 'user-isolation-1';
            sessionManager.addMessage(user1, 'user', '合肥的天气怎么样？');
            sessionManager.addMessage(user1, 'assistant', '合肥天气晴朗，25°C');
            sessionManager.addMessage(user1, 'user', '那北京呢？');

            // User 2 has different conversation
            const user2 = 'user-isolation-2';
            sessionManager.addMessage(user2, 'user', '上海怎么样？');
            sessionManager.addMessage(user2, 'assistant', '上海天气晴朗，26°C');

            // Get histories
            const history1 = sessionManager.getSessionHistory(user1);
            const history2 = sessionManager.getSessionHistory(user2);

            // User 1 should have 3 messages about Hefei and Beijing
            expect(history1.length).toBe(3);
            const context1 = history1.map(m => m.content).join(' ');
            expect(context1).toContain('合肥');
            expect(context1).toContain('北京');

            // User 2 should have 2 messages about Shanghai
            expect(history2.length).toBe(2);
            const context2 = history2.map(m => m.content).join(' ');
            expect(context2).toContain('上海');
            expect(context2).not.toContain('合肥');
            expect(context2).not.toContain('北京');
        });

        it('should not leak context between sessions', () => {
            // User A session
            const userA = 'user-leak-a';
            sessionManager.addMessage(userA, 'user', '我喜欢咖啡');
            sessionManager.addMessage(userA, 'assistant', '好的，记住了');

            // User B session
            const userB = 'user-leak-b';
            sessionManager.addMessage(userB, 'user', '我也喜欢');

            // User B should not have context from User A
            const historyB = sessionManager.getSessionHistory(userB);
            const contextB = historyB.map(m => m.content).join(' ');
            expect(contextB).not.toContain('咖啡');
        });
    });

    // ========================================================================
    // Cross-Session Context Resolution
    // ========================================================================

    describe('Cross-Session Context Resolution', () => {
        it('should resolve coreference within same session', () => {
            const userId = 'user-cross-session';

            // First message: Establish context
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '今天合肥天气晴朗，温度 25°C');

            // Second message: Coreference
            sessionManager.addMessage(userId, 'user', '那北京呢？');

            // Verify context is maintained
            const history = sessionManager.getSessionHistory(userId);
            expect(history.length).toBe(3);

            // Simulate LLM receiving context
            const context = history.map(m => `${m.role}: ${m.content}`).join('\n');
            expect(context).toContain('合肥'); // Previous context
            expect(context).toContain('那北京呢？'); // Current query
        });

        it('should handle multiple coreferences in sequence', () => {
            const userId = 'user-multiple-coreference';

            // Establish topic: weather
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '合肥天气晴朗，25°C');

            // Coreference 1
            sessionManager.addMessage(userId, 'user', '那北京呢？');
            sessionManager.addMessage(userId, 'assistant', '北京天气多云，22°C');

            // Coreference 2
            sessionManager.addMessage(userId, 'user', '上海呢？');
            sessionManager.addMessage(userId, 'assistant', '上海天气晴朗，26°C');

            // Coreference 3
            sessionManager.addMessage(userId, 'user', '广州怎么样？');
            sessionManager.addMessage(userId, 'assistant', '广州天气阴天，24°C');

            // Verify all context is maintained
            const history = sessionManager.getSessionHistory(userId);
            expect(history.length).toBe(8); // 4 user + 4 assistant = 8 messages

            const context = history.map(m => m.content).join(' ');
            expect(context).toContain('合肥');
            expect(context).toContain('北京');
            expect(context).toContain('上海');
            expect(context).toContain('广州');
        });

        it('should handle coreference with different topics', () => {
            const userId = 'user-different-topics';

            // Topic 1: Weather
            sessionManager.addMessage(userId, 'user', '合肥天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '晴朗，25°C');

            // Switch topic: Food
            sessionManager.addMessage(userId, 'user', '那有什么好吃的？');
            sessionManager.addMessage(userId, 'assistant', '合肥有鸭油烧饼');

            // Coreference to weather topic
            sessionManager.addMessage(userId, 'user', '刚才说北京呢？');

            // Should still have weather context
            const history = sessionManager.getSessionHistory(userId);
            const context = history.map(m => m.content).join(' ');
            expect(context).toContain('合肥天气');
            expect(context).toContain('北京');
        });
    });

    // ========================================================================
    // Context Limitations
    // ========================================================================

    describe('Context Limitations', () => {
        it('should limit context when session size is exceeded', () => {
            const userId = 'user-context-limit';
            const limitedSessionManager = new SessionManager(memoryManager, {
                maxMessages: 6 // Very small limit for testing
            });

            // Add more messages than limit
            for (let i = 0; i < 10; i++) {
                limitedSessionManager.addMessage(userId, 'user', `Message ${i}`);
                limitedSessionManager.addMessage(userId, 'assistant', `Response ${i}`);
            }

            // Get history
            const history = limitedSessionManager.getSessionHistory(userId);

            // Should be limited to 6 messages
            expect(history.length).toBe(6);

            // First 7 message pairs should be removed (FIFO), keeping last 3 pairs (messages 7-9)
            expect(history[0].content).toBe('Message 7');
            expect(history[5].content).toBe('Response 9');

            limitedSessionManager.destroy();
        });

        it('should maintain recent context even when old context is removed', () => {
            const userId = 'user-recent-context';
            const limitedSessionManager = new SessionManager(memoryManager, {
                maxMessages: 4
            });

            // Establish context (will be removed)
            limitedSessionManager.addMessage(userId, 'user', 'Initial context about Hefei');
            limitedSessionManager.addMessage(userId, 'assistant', 'Hefei weather is sunny');

            // Add more messages (this will cause the first message to be removed)
            limitedSessionManager.addMessage(userId, 'user', 'Message 1');
            limitedSessionManager.addMessage(userId, 'assistant', 'Response 1');
            limitedSessionManager.addMessage(userId, 'user', '那北京呢？'); // Coreference

            // Get history
            const history = limitedSessionManager.getSessionHistory(userId);

            // Should have last 4 messages
            expect(history.length).toBe(4);

            // First user message about Hefei should be removed, but assistant response remains
            const context = history.map(m => m.content).join(' ');
            expect(context).toContain('Hefei weather is sunny'); // Still present (second message)
            expect(context).not.toContain('Initial context about Hefei'); // Removed (first message)

            limitedSessionManager.destroy();
        });
    });

    // ========================================================================
    // Integration with Memory System
    // ========================================================================

    describe('Integration with Memory System', () => {
        it('should work with frozen snapshot loading', () => {
            const userId = 'user-frozen-snapshot';

            // Create session (loads frozen snapshot)
            sessionManager.getOrCreateSession(userId);

            // Add messages
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '合肥天气晴朗，25°C');

            // Snapshot should be loaded once
            const session = sessionManager.getOrCreateSession(userId);
            expect(session.snapshotLoaded).toBe(true);

            // History should be available
            const history = sessionManager.getSessionHistory(userId);
            expect(history.length).toBe(2);
        });

        it('should invalidate snapshot when session is cleared', () => {
            const userId = 'user-snapshot-invalidate';

            // Create session and add messages
            sessionManager.getOrCreateSession(userId);
            sessionManager.addMessage(userId, 'user', 'Test message');

            // Clear session
            sessionManager.clearSession(userId);

            // New session should reload snapshot
            const newSession = sessionManager.getOrCreateSession(userId);
            expect(newSession.snapshotLoaded).toBe(true);
            expect(newSession.messages.length).toBe(0);
        });

        it('should integrate with MemoryManager conversation tracking', () => {
            const userId = 'user-conversation-tracking';

            // Start conversation
            const conversationId = memoryManager.startConversation(userId);

            // Add messages to session
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '合肥天气晴朗，25°C');

            // Link session to conversation
            const session = sessionManager.getOrCreateSession(userId);
            session.conversationId = conversationId;

            // Verify link
            expect(session.conversationId).toBe(conversationId);

            // End conversation
            memoryManager.endConversation(conversationId, 'completed');
        });
    });

    // ========================================================================
    // Real-World Scenarios
    // ========================================================================

    describe('Real-World Scenarios', () => {
        it('should handle follow-up questions about weather', () => {
            const userId = 'user-weather-followup';

            // Initial question
            sessionManager.addMessage(userId, 'user', '今天合肥的天气怎么样？');
            sessionManager.addMessage(userId, 'assistant', '今天合肥天气晴朗，温度 25°C，适合外出。');

            // Follow-up question about same city
            sessionManager.addMessage(userId, 'user', '需要带伞吗？');
            sessionManager.addMessage(userId, 'assistant', '今天合肥天气晴朗，不需要带伞。');

            // Follow-up question about different city (coreference)
            sessionManager.addMessage(userId, 'user', '那北京呢？');

            // Get context
            const history = sessionManager.getSessionHistory(userId);
            const context = history.map(m => m.content).join(' ');

            // Should have all context
            expect(context).toContain('合肥');
            expect(context).toContain('北京');
            expect(context).toContain('伞');
        });

        it('should handle multi-turn task completion', () => {
            const userId = 'user-multi-turn-task';

            // Step 1: User asks to debug
            sessionManager.addMessage(userId, 'user', '帮我调试 API 问题');
            sessionManager.addMessage(userId, 'assistant', '好的，让我检查日志文件。');

            // Step 2: Agent finds error
            sessionManager.addMessage(userId, 'assistant', '我发现了认证错误');

            // Step 3: User asks about fix
            sessionManager.addMessage(userId, 'user', '怎么修复？');

            // Step 4: Agent provides solution
            sessionManager.addMessage(userId, 'assistant', '需要刷新 JWT token');

            // Step 5: User asks about different issue (coreference)
            sessionManager.addMessage(userId, 'user', '那数据库连接呢？');

            // Get context
            const history = sessionManager.getSessionHistory(userId);
            const context = history.map(m => m.content).join(' ');

            // Should maintain debugging context
            expect(context).toContain('API');
            expect(context).toContain('认证错误');
            expect(context).toContain('数据库');
        });

        it('should handle pronoun references', () => {
            const userId = 'user-pronoun-reference';

            // Establish subject
            sessionManager.addMessage(userId, 'user', '合肥今天下雨吗？');
            sessionManager.addMessage(userId, 'assistant', '合肥今天没有下雨，天气晴朗。');

            // Pronoun reference
            sessionManager.addMessage(userId, 'user', '它明天会下雨吗？');

            // Get context
            const history = sessionManager.getSessionHistory(userId);
            const context = history.map(m => m.content).join(' ');

            // Should have context about Hefei
            expect(context).toContain('合肥');
            expect(context).toContain('明天');
        });
    });
});
