import { MemoryManager } from '../../src/memory/manager.js';
import fs from 'fs/promises';
import fsSync from 'fs';

describe('MemoryManager', () => {
    const testDbPath = './test-manager.db';
    const testMemDir = './test-memories';
    let manager: MemoryManager;

    beforeEach(async () => {
        // Clean up
        try { await fs.unlink(testDbPath); } catch {}
        try { await fs.unlink(testDbPath + '-wal'); } catch {}
        try { await fs.unlink(testDbPath + '-shm'); } catch {}

        // Create memories directory
        await fs.mkdir(testMemDir, { recursive: true });

        manager = new MemoryManager({
            dbPath: testDbPath,
            memoriesDir: testMemDir,
            skillsDir: './test-skills'
        });
    });

    afterEach(() => {
        manager.close();
        // Cleanup
        try { fsSync.unlinkSync(testDbPath); } catch {}
        try { fsSync.unlinkSync(testDbPath + '-wal'); } catch {}
        try { fsSync.unlinkSync(testDbPath + '-shm'); } catch {}
    });

    describe('Initialization', () => {
        it('should initialize MemoryStorage and PromptMemory', () => {
            expect(manager['storage']).toBeDefined();
            expect(manager['promptMemory']).toBeDefined();
        });

        it('should create default memory files', async () => {
            const memoryPath = `${testMemDir}/MEMORY.md`;
            const userPath = `${testMemDir}/USER.md`;

            // Wait for file creation to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Check files exist
            await fs.access(memoryPath);
            await fs.access(userPath);
        });
    });

    describe('MemoryStorage Delegation', () => {
        it('should create conversation', () => {
            manager.createConversation({
                id: 'test-conv',
                userId: 'user-1',
                startTime: Date.now(),
                status: 'active'
            });

            const conv = manager.getConversation('test-conv');
            expect(conv).toBeDefined();
            expect(conv?.id).toBe('test-conv');
        });

        it('should save and retrieve LLM interactions', () => {
            const convId = manager.startConversation('user-1');

            manager.saveLLMInteraction(
                convId,
                'Test prompt',
                'Test response',
                'gpt-4',
                100,
                false
            );

            const interactions = manager.getLLMInteractions(convId);
            expect(interactions.length).toBe(1);
        });

        it('should perform FTS5 search', () => {
            const convId = manager.startConversation();

            manager.saveLLMInteraction(
                convId,
                'What is the weather in Beijing?',
                'Beijing weather is sunny.',
                'gpt-4'
            );

            const results = manager.fts5Search('Beijing');
            expect(results.length).toBeGreaterThan(0);
        });
    });

    describe('PromptMemory Delegation', () => {
        it('should load frozen snapshot', async () => {
            const snapshot = await manager.loadFrozenSnapshot();
            expect(snapshot).toContain('Persistent Memory');
        });

        it('should add to memory', async () => {
            await manager.addToMemory('memory', 'Test fact');

            const stats = await manager.getStats();
            expect(stats.memory.current).toBeGreaterThan(0);
        });

        it('should return PromptMemory instance', () => {
            const promptMemory = manager.getPromptMemory();
            expect(promptMemory).toBeDefined();
            expect(promptMemory.loadFrozenSnapshot).toBeDefined();
        });
    });

    describe('Conversation Lifecycle', () => {
        it('should start and end conversation', () => {
            const convId = manager.startConversation('user-1');

            const conv1 = manager.getConversation(convId);
            expect(conv1?.status).toBe('active');

            manager.endConversation(convId, 'completed');

            const conv2 = manager.getConversation(convId);
            expect(conv2?.status).toBe('completed');
            expect(conv2?.endTime).toBeDefined();
        });
    });

    describe('Integration Tests', () => {
        it('should handle complete workflow', async () => {
            // Start conversation
            const convId = manager.startConversation('user-1');

            // Add memory
            await manager.addToMemory('memory', 'User prefers TypeScript');

            // Save interaction
            manager.saveLLMInteraction(
                convId,
                'Help with debugging',
                'Check console logs',
                'gpt-4'
            );

            // End conversation
            manager.endConversation(convId, 'completed');

            // Verify
            const conv = manager.getConversation(convId);
            expect(conv?.status).toBe('completed');
        });
    });
});
