import { SessionManager } from '../../src/memory/session-manager.js';
import { MemoryManager } from '../../src/memory/manager.js';
import fs from 'fs/promises';

describe('SessionManager', () => {
    const testDbPath = './test-session-manager.db';
    const testMemoriesDir = './test-session-manager-memories';
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

        // Initialize SessionManager with default configuration
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
    // Session Creation and Retrieval
    // ========================================================================

    describe('Session Creation and Retrieval', () => {
        it('should create and retrieve sessions', () => {
            const session = sessionManager.getOrCreateSession('user-1');

            expect(session.userId).toBe('user-1');
            expect(session.messages.length).toBe(0);
            expect(session.lastActivity).toBeGreaterThan(0);
            expect(session.snapshotLoaded).toBe(true);
        });

        it('should return existing session on subsequent calls', () => {
            const session1 = sessionManager.getOrCreateSession('user-1');
            const session2 = sessionManager.getOrCreateSession('user-1');

            expect(session1).toBe(session2);
            expect(session1.lastActivity).toBe(session2.lastActivity);
        });

        it('should create separate sessions for different users', () => {
            const session1 = sessionManager.getOrCreateSession('user-1');
            const session2 = sessionManager.getOrCreateSession('user-2');

            expect(session1.userId).toBe('user-1');
            expect(session2.userId).toBe('user-2');
            expect(session1).not.toBe(session2);
        });

        it('should update lastActivity on each access', async () => {
            const session1 = sessionManager.getOrCreateSession('user-1');
            const firstActivity = session1.lastActivity;

            // Wait a bit to ensure timestamp difference
            await new Promise(resolve => setTimeout(resolve, 10));

            const session2 = sessionManager.getOrCreateSession('user-1');
            const secondActivity = session2.lastActivity;

            expect(secondActivity).toBeGreaterThan(firstActivity);
        });
    });

    // ========================================================================
    // Adding Messages to Session
    // ========================================================================

    describe('Adding Messages to Session', () => {
        it('should add messages to session', () => {
            sessionManager.addMessage('user-1', 'user', 'Hello');
            sessionManager.addMessage('user-1', 'assistant', 'Hi there!');

            const history = sessionManager.getSessionHistory('user-1');

            expect(history.length).toBe(2);
            expect(history[0].content).toBe('Hello');
            expect(history[0].role).toBe('user');
            expect(history[1].content).toBe('Hi there!');
            expect(history[1].role).toBe('assistant');
        });

        it('should add timestamp to messages', () => {
            const beforeTime = Date.now();
            sessionManager.addMessage('user-1', 'user', 'Test message');
            const afterTime = Date.now();

            const history = sessionManager.getSessionHistory('user-1');

            expect(history[0].timestamp).toBeGreaterThanOrEqual(beforeTime);
            expect(history[0].timestamp).toBeLessThanOrEqual(afterTime);
        });

        it('should create session if it does not exist when adding message', () => {
            expect(sessionManager.getStats().activeSessions).toBe(0);

            sessionManager.addMessage('user-1', 'user', 'Hello');

            expect(sessionManager.getStats().activeSessions).toBe(1);
        });
    });

    // ========================================================================
    // Session Size Limit (FIFO)
    // ========================================================================

    describe('Session Size Limit (FIFO)', () => {
        it('should limit session size using FIFO queue', () => {
            const limitedSessionManager = new SessionManager(memoryManager, {
                maxMessages: 5,
                sessionTimeout: 30 * 60 * 1000,
                cleanupInterval: 5 * 60 * 1000
            });

            // Add 10 messages
            for (let i = 0; i < 10; i++) {
                limitedSessionManager.addMessage('user-fifo', 'user', `Message ${i}`);
            }

            const history = limitedSessionManager.getSessionHistory('user-fifo');

            // Should only have 5 messages (the most recent)
            expect(history.length).toBe(5);
            // First 5 messages should be removed (FIFO)
            expect(history[0].content).toBe('Message 5');
            expect(history[4].content).toBe('Message 9');

            limitedSessionManager.destroy();
        });

        it('should not remove messages when under limit', () => {
            const limitedSessionManager = new SessionManager(memoryManager, {
                maxMessages: 10,
                sessionTimeout: 30 * 60 * 1000,
                cleanupInterval: 5 * 60 * 1000
            });

            // Add 5 messages
            for (let i = 0; i < 5; i++) {
                limitedSessionManager.addMessage('user-limit', 'user', `Message ${i}`);
            }

            const history = limitedSessionManager.getSessionHistory('user-limit');

            expect(history.length).toBe(5);
            expect(history[0].content).toBe('Message 0');
            expect(history[4].content).toBe('Message 4');

            limitedSessionManager.destroy();
        });
    });

    // ========================================================================
    // Session Statistics
    // ========================================================================

    describe('Session Statistics', () => {
        it('should track active sessions', () => {
            expect(sessionManager.getStats().activeSessions).toBe(0);

            sessionManager.getOrCreateSession('user-1');
            expect(sessionManager.getStats().activeSessions).toBe(1);

            sessionManager.getOrCreateSession('user-2');
            expect(sessionManager.getStats().activeSessions).toBe(2);

            sessionManager.getOrCreateSession('user-1'); // Same user
            expect(sessionManager.getStats().activeSessions).toBe(2);
        });

        it('should track total messages across all sessions', () => {
            sessionManager.addMessage('user-1', 'user', 'Message 1');
            sessionManager.addMessage('user-1', 'assistant', 'Response 1');
            sessionManager.addMessage('user-2', 'user', 'Message 2');

            const stats = sessionManager.getStats();

            expect(stats.totalMessages).toBe(3);
        });

        it('should return zero stats when no sessions exist', () => {
            const stats = sessionManager.getStats();

            expect(stats.activeSessions).toBe(0);
            expect(stats.totalMessages).toBe(0);
        });
    });

    // ========================================================================
    // Session Expiration
    // ========================================================================

    describe('Session Expiration', () => {
        it('should identify non-expired sessions', () => {
            sessionManager.getOrCreateSession('user-1');

            expect(sessionManager.isSessionExpired('user-1')).toBe(false);
        });

        it('should identify expired sessions', async () => {
            const shortTimeoutSessionManager = new SessionManager(memoryManager, {
                sessionTimeout: 100, // 100ms timeout
                maxMessages: 20,
                cleanupInterval: 5 * 60 * 1000
            });

            shortTimeoutSessionManager.getOrCreateSession('user-expire');

            // Wait for session to expire
            await new Promise(resolve => setTimeout(resolve, 150));

            expect(shortTimeoutSessionManager.isSessionExpired('user-expire')).toBe(true);

            shortTimeoutSessionManager.destroy();
        });

        it('should return true for non-existent sessions', () => {
            expect(sessionManager.isSessionExpired('non-existent')).toBe(true);
        });
    });

    // ========================================================================
    // Clear Session
    // ========================================================================

    describe('Clear Session', () => {
        it('should clear session and remove messages', () => {
            sessionManager.addMessage('user-1', 'user', 'Message 1');
            sessionManager.addMessage('user-1', 'assistant', 'Response 1');

            expect(sessionManager.getSessionHistory('user-1').length).toBe(2);

            sessionManager.clearSession('user-1');

            expect(sessionManager.getSessionHistory('user-1').length).toBe(0);
        });

        it('should decrease active session count', () => {
            sessionManager.getOrCreateSession('user-1');
            expect(sessionManager.getStats().activeSessions).toBe(1);

            sessionManager.clearSession('user-1');
            expect(sessionManager.getStats().activeSessions).toBe(0);
        });

        it('should invalidate frozen snapshot when clearing session', () => {
            const session = sessionManager.getOrCreateSession('user-1');
            expect(session.snapshotLoaded).toBe(true);

            // Clear session should invalidate snapshot
            sessionManager.clearSession('user-1');

            // New session should reload snapshot
            const newSession = sessionManager.getOrCreateSession('user-1');
            expect(newSession.snapshotLoaded).toBe(true);
        });

        it('should handle clearing non-existent session gracefully', () => {
            expect(() => {
                sessionManager.clearSession('non-existent');
            }).not.toThrow();
        });
    });

    // ========================================================================
    // Snapshot Loading
    // ========================================================================

    describe('Snapshot Loading', () => {
        it('should load frozen snapshot on first session access', async () => {
            // Create a new session manager
            const newSessionManager = new SessionManager(memoryManager);
            const session = newSessionManager.getOrCreateSession('user-snapshot');

            // Snapshot should be marked as loaded
            expect(session.snapshotLoaded).toBe(true);

            newSessionManager.destroy();
        });

        it('should not reload snapshot for same session', async () => {
            const session1 = sessionManager.getOrCreateSession('user-reload');
            expect(session1.snapshotLoaded).toBe(true);

            // Access same session again
            const session2 = sessionManager.getOrCreateSession('user-reload');
            expect(session2.snapshotLoaded).toBe(true);
            expect(session1).toBe(session2);
        });
    });

    // ========================================================================
    // Configuration
    // ========================================================================

    describe('Configuration', () => {
        it('should use default configuration when not provided', () => {
            const defaultSessionManager = new SessionManager(memoryManager);

            // Add messages to test default maxMessages
            for (let i = 0; i < 25; i++) {
                defaultSessionManager.addMessage('user-default', 'user', `Message ${i}`);
            }

            // Default maxMessages should be 20
            const history = defaultSessionManager.getSessionHistory('user-default');
            expect(history.length).toBe(20);

            defaultSessionManager.destroy();
        });

        it('should use custom configuration when provided', () => {
            const customSessionManager = new SessionManager(memoryManager, {
                sessionTimeout: 60 * 60 * 1000, // 1 hour
                maxMessages: 50,
                cleanupInterval: 10 * 60 * 1000 // 10 minutes
            });

            // Add messages to test custom maxMessages
            for (let i = 0; i < 55; i++) {
                customSessionManager.addMessage('user-custom', 'user', `Message ${i}`);
            }

            // Custom maxMessages should be 50
            const history = customSessionManager.getSessionHistory('user-custom');
            expect(history.length).toBe(50);

            customSessionManager.destroy();
        });

        it('should merge partial configuration with defaults', () => {
            const partialSessionManager = new SessionManager(memoryManager, {
                maxMessages: 15
            });

            // Add messages to test custom maxMessages
            for (let i = 0; i < 20; i++) {
                partialSessionManager.addMessage('user-partial', 'user', `Message ${i}`);
            }

            // Custom maxMessages should be 15
            const history = partialSessionManager.getSessionHistory('user-partial');
            expect(history.length).toBe(15);

            partialSessionManager.destroy();
        });
    });

    // ========================================================================
    // Integration with MemoryManager
    // ========================================================================

    describe('Integration with MemoryManager', () => {
        it('should link session to conversation', () => {
            const session = sessionManager.getOrCreateSession('user-conv');

            // Start conversation through MemoryManager
            const conversationId = memoryManager.startConversation('user-conv');

            // Link conversation to session
            session.conversationId = conversationId;

            expect(session.conversationId).toBe(conversationId);

            // End conversation
            memoryManager.endConversation(conversationId, 'completed');
        });

        it('should access PromptMemory through MemoryManager', () => {
            const promptMemory = memoryManager.getPromptMemory();

            expect(promptMemory).toBeDefined();
            expect(typeof promptMemory.loadFrozenSnapshot).toBe('function');
            expect(typeof promptMemory.invalidateSnapshot).toBe('function');
        });
    });

    // ========================================================================
    // Lifecycle
    // ========================================================================

    describe('Lifecycle', () => {
        it('should start cleanup interval on construction', () => {
            const newSessionManager = new SessionManager(memoryManager);

            // Wait a bit to ensure interval is started
            // (We can't directly test the interval, but we can verify no errors)
            expect(() => {
                newSessionManager.getOrCreateSession('user-lifecycle');
            }).not.toThrow();

            newSessionManager.destroy();
        });

        it('should cleanup interval on destroy', () => {
            const newSessionManager = new SessionManager(memoryManager);
            newSessionManager.destroy();

            // Should not throw when using after destroy
            expect(() => {
                newSessionManager.getStats();
            }).not.toThrow();
        });

        it('should handle multiple destroy calls gracefully', () => {
            const newSessionManager = new SessionManager(memoryManager);

            expect(() => {
                newSessionManager.destroy();
                newSessionManager.destroy();
                newSessionManager.destroy();
            }).not.toThrow();
        });
    });
});
