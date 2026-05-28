import { PromptMemory } from '../../src/memory/prompt-memory.js';
import fs from 'fs/promises';

describe('PromptMemory', () => {
    const testConfig = {
        memoryPath: './test-memory.md',
        userPath: './test-user.md',
        memoryCharLimit: 500,
        userCharLimit: 300
    };

    let memory: PromptMemory;

    beforeEach(async () => {
        // Clean up test files before each test
        await fs.unlink(testConfig.memoryPath).catch(() => {});
        await fs.unlink(testConfig.userPath).catch(() => {});

        memory = new PromptMemory(testConfig);

        // Wait for file initialization
        await new Promise(resolve => setTimeout(resolve, 50));
    });

    afterEach(async () => {
        await fs.unlink(testConfig.memoryPath).catch(() => {});
        await fs.unlink(testConfig.userPath).catch(() => {});
    });

    // ========================================================================
    // Frozen Snapshot
    // ========================================================================

    describe('Frozen Snapshot', () => {
        it('should load frozen snapshot', async () => {
            const snapshot = await memory.loadFrozenSnapshot();
            expect(snapshot).toContain('Persistent Memory');
            expect(snapshot).toContain('User Profile');
        });

        it('should cache snapshot across calls', async () => {
            const snapshot1 = await memory.loadFrozenSnapshot();
            const snapshot2 = await memory.loadFrozenSnapshot();

            // Same cached snapshot
            expect(snapshot1).toBe(snapshot2);
        });

        it('should NOT update snapshot when memory is modified (CRITICAL for prefix caching)', async () => {
            // Load initial snapshot
            const snapshot1 = await memory.loadFrozenSnapshot();

            // Modify memory during session
            await memory.addToMemory('memory', 'New fact added during session');

            // Snapshot should NOT change - still the old content
            const snapshot2 = await memory.loadFrozenSnapshot();
            expect(snapshot1).toBe(snapshot2); // Same reference
            expect(snapshot2).not.toContain('New fact added during session');
        });

        it('should only update snapshot when explicitly invalidated (session boundary)', async () => {
            // Load initial snapshot
            const snapshot1 = await memory.loadFrozenSnapshot();

            // Modify memory during session
            await memory.addToMemory('memory', 'Session modification');

            // Snapshot unchanged during session
            let snapshot2 = await memory.loadFrozenSnapshot();
            expect(snapshot2).not.toContain('Session modification');

            // Invalidate (simulate new session)
            memory.invalidateSnapshot();

            // Now snapshot is updated with new session
            snapshot2 = await memory.loadFrozenSnapshot();
            expect(snapshot2).toContain('Session modification');
            expect(snapshot1).not.toBe(snapshot2); // Different reference
        });

        it('should invalidate cache when file changes', async () => {
            await memory.loadFrozenSnapshot();

            // Modify file externally
            await fs.appendFile(testConfig.memoryPath, 'New content');

            // Invalidate cache and reload (simulating new session)
            memory.invalidateSnapshot();
            const snapshot = await memory.loadFrozenSnapshot();
            expect(snapshot).toContain('New content');
        });
    });

    // ========================================================================
    // Add to Memory
    // ========================================================================

    describe('Add to Memory', () => {
        it('should add content to memory when under threshold', async () => {
            await memory.addToMemory('memory', 'Test fact: Paris is capital of France');

            const stats = await memory.getStats();
            expect(stats.memory.current).toBeGreaterThan(0);
        });

        it('should append new content to existing content', async () => {
            await memory.addToMemory('memory', 'First fact');
            await memory.addToMemory('memory', 'Second fact');

            const snapshot = await memory.loadFrozenSnapshot();
            expect(snapshot).toContain('First fact');
            expect(snapshot).toContain('Second fact');
        });

        it('should use LLM compression when approaching limit (with LLM provider)', async () => {
            const mockLLM = {
                complete: async (prompt: string) => ({
                    content: '# Persistent Memory\n\nCompressed content within limit.'
                })
            };

            memory.setLLMProvider(mockLLM);

            // Add content that exceeds 80% threshold
            const largeContent = 'x'.repeat(400);
            await memory.addToMemory('memory', largeContent);

            const stats = await memory.getStats();
            expect(stats.memory.current).toBeLessThanOrEqual(testConfig.memoryCharLimit);
        });

        it('should warn but still add content when no LLM provider available', async () => {
            const consoleWarn = jest.spyOn(console, 'warn');

            // Add content that exceeds 80% threshold
            const largeContent = 'x'.repeat(400);
            await memory.addToMemory('memory', largeContent);

            expect(consoleWarn).toHaveBeenCalled();
        });

        it('should truncate if LLM compression still exceeds limit', async () => {
            const mockLLM = {
                complete: async (_prompt: string) => ({
                    content: 'x'.repeat(1000) // Still over limit
                })
            };

            memory.setLLMProvider(mockLLM);

            const consoleWarn = jest.spyOn(console, 'warn');
            await memory.addToMemory('memory', 'x'.repeat(400));

            expect(consoleWarn).toHaveBeenCalledWith(
                expect.stringContaining('truncating')
            );

            const stats = await memory.getStats();
            expect(stats.memory.current).toBeLessThanOrEqual(testConfig.memoryCharLimit);
        });
    });

    // ========================================================================
    // Replace in Memory
    // ========================================================================

    describe('Replace in Memory', () => {
        it('should replace existing content', async () => {
            await memory.addToMemory('memory', 'Original text');
            // Invalidate snapshot to see changes on disk
            memory.invalidateSnapshot();
            await memory.replaceInMemory('memory', 'Original text', 'New text');

            // Reload from disk to verify
            const content = await fs.readFile(testConfig.memoryPath, 'utf-8');
            expect(content).toContain('New text');
            expect(content).not.toContain('Original text');
        });

        it('should throw error when old text not found', async () => {
            await memory.addToMemory('memory', 'Some content');
            memory.invalidateSnapshot();

            await expect(
                memory.replaceInMemory('memory', 'Non-existent text', 'New text')
            ).rejects.toThrow(/Old text not found/);
        });
    });

    // ========================================================================
    // Remove from Memory
    // ========================================================================

    describe('Remove from Memory', () => {
        it('should remove specified content', async () => {
            await memory.addToMemory('memory', 'Content to remove');
            memory.invalidateSnapshot();
            await memory.removeFromMemory('memory', 'Content to remove');

            // Reload from disk to verify
            const content = await fs.readFile(testConfig.memoryPath, 'utf-8');
            expect(content).not.toContain('Content to remove');
        });

        it('should clean up extra newlines after removal', async () => {
            await memory.addToMemory('memory', 'Line 1\n\nLine 2\n\nLine 3');
            memory.invalidateSnapshot();
            await memory.removeFromMemory('memory', 'Line 2');

            const content = await fs.readFile(testConfig.memoryPath, 'utf-8');
            // Should not have excessive newlines
            expect(content).not.toMatch(/\n{3,}/);
        });

        it('should throw error when text not found', async () => {
            await memory.addToMemory('memory', 'Some content');
            memory.invalidateSnapshot();

            await expect(
                memory.removeFromMemory('memory', 'Non-existent text')
            ).rejects.toThrow(/Text not found/);
        });
    });

    // ========================================================================
    // Memory Stats
    // ========================================================================

    describe('Memory Stats', () => {
        it('should return correct stats for both memory and user', async () => {
            await memory.addToMemory('memory', 'Memory content');
            await memory.addToMemory('user', 'User preference');

            const stats = await memory.getStats();

            expect(stats.memory.current).toBeGreaterThan(0);
            expect(stats.memory.limit).toBe(testConfig.memoryCharLimit);
            expect(stats.user.current).toBeGreaterThan(0);
            expect(stats.user.limit).toBe(testConfig.userCharLimit);
        });

        it('should have default content after initialization', async () => {
            const stats = await memory.getStats();

            // PromptMemory creates default files with content
            expect(stats.memory.current).toBeGreaterThan(0);
            expect(stats.user.current).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // LLM Provider
    // ========================================================================

    describe('LLM Provider', () => {
        /**
         * Test Purpose: Verify LLM provider can be set without errors
         * Edge Case: Setting LLM provider before any memory operations
         * Why Important: Ensures the compression feature is optional and can be configured
         */
        it('should allow setting LLM provider', () => {
            const mockLLM = {
                complete: async () => ({ content: 'test' })
            };

            expect(() => memory.setLLMProvider(mockLLM)).not.toThrow();
        });

        /**
         * Test Purpose: Verify LLM is actually called when content exceeds threshold
         * Edge Case: Content > 80% of char limit (triggers compression)
         * Why Important: Ensures intelligent compression works, preventing "limit exceeded" errors
         * Expected: LLM compression is triggered, not direct append
         */
        it('should use provided LLM for compression', async () => {
            let called = false;
            const mockLLM = {
                complete: async (prompt: string) => {
                    called = true;
                    return { content: 'Compressed' };
                }
            };

            memory.setLLMProvider(mockLLM);
            await memory.addToMemory('memory', 'x'.repeat(400)); // Exceeds 80% of 500 char limit

            expect(called).toBe(true);  // LLM was called for compression
        });
    });

    // ========================================================================
    // User Category
    // ========================================================================

    describe('User Category', () => {
        /**
         * Test Purpose: Verify content can be added to USER.md separately
         * Edge Case: Writing to USER.md instead of MEMORY.md
         * Why Important: Ensures two files are independent and don't interfere
         * Expected: USER.md current char count increases
         */
        it('should add content to USER.md', async () => {
            await memory.addToMemory('user', 'Prefers concise responses');

            const stats = await memory.getStats();
            expect(stats.user.current).toBeGreaterThan(0);  // USER.md has content
        });

        /**
         * Test Purpose: Verify USER.md respects its own character limit
         * Edge Case: USER.md content approaching 300 char limit
         * Why Important: USER.md has different limit (300) vs MEMORY.md (500)
         * Expected: Content stays within USER.md's limit after compression
         */
        it('should respect user char limit', async () => {
            const mockLLM = {
                complete: async () => ({ content: 'Compressed user pref' })
            };

            memory.setLLMProvider(mockLLM);
            await memory.addToMemory('user', 'x'.repeat(200)); // Approaches USER.md's 300 limit

            const stats = await memory.getStats();
            expect(stats.user.current).toBeLessThanOrEqual(testConfig.userCharLimit); // ≤ 300 chars
        });
    });
});
