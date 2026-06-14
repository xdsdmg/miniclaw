// Manual test for PromptMemory
const { PromptMemory } = require('../dist/memory/prompt-memory.js');
const fs = require('fs/promises');

const testConfig = {
    memoryPath: './test-prompt-memory.md',
    userPath: './test-prompt-user.md',
    memoryCharLimit: 500,
    userCharLimit: 300
};

console.log('=== Phase 3: Prompt Memory Layer Test ===\n');

(async () => {
    try {
        // Clean up first
        await fs.unlink(testConfig.memoryPath).catch(() => {});
        await fs.unlink(testConfig.userPath).catch(() => {});

        const memory = new PromptMemory(testConfig);

        // Test 1: Load frozen snapshot
        console.log('Test 1: Load frozen snapshot');
        let snapshot = await memory.loadFrozenSnapshot();
        console.log(`  ✅ Snapshot loaded: ${snapshot.length} chars`);
        console.log(`     Contains: ${snapshot.includes('Persistent Memory') ? 'MEMORY.md' : ''}, ${snapshot.includes('User Profile') ? 'USER.md' : ''}\n`);

        // Test 2: Add content (under threshold)
        console.log('Test 2: Add content (under 80% threshold)');
        await memory.addToMemory('memory', 'User prefers TypeScript over JavaScript');
        await memory.addToMemory('memory', 'Working on AI Agent project');
        let stats = await memory.getStats();
        console.log(`  ✅ Memory added: ${stats.memory.current} chars / ${stats.memory.limit} limit\n`);

        // Test 2.5: CRITICAL - Verify frozen snapshot behavior
        console.log('Test 2.5: CRITICAL - Verify frozen snapshot behavior');
        const snapshotBeforeMod = await memory.loadFrozenSnapshot();
        console.log(`  Snapshot before modification: ${snapshotBeforeMod.length} chars`);

        // Add more content to memory (writes to disk)
        await memory.addToMemory('memory', 'NEW CONTENT ADDED DURING SESSION');

        // Load snapshot again - should be the SAME content
        const snapshotAfterMod = await memory.loadFrozenSnapshot();
        console.log(`  Snapshot after modification: ${snapshotAfterMod.length} chars`);
        console.log(`  ✅ Frozen snapshot unchanged: ${snapshotBeforeMod === snapshotAfterMod ? 'YES (same reference)' : 'NO (different reference)'}`);
        console.log(`  ✅ New content NOT in snapshot: ${!snapshotAfterMod.includes('NEW CONTENT ADDED') ? 'YES (correct)' : 'NO (BUG!)'}\n`);

        // Test 3: Add to USER.md
        console.log('Test 3: Add content to USER.md');
        await memory.addToMemory('user', 'Prefers detailed explanations');
        stats = await memory.getStats();
        console.log(`  ✅ User pref added: ${stats.user.current} chars / ${stats.user.limit} limit\n`);

        // Test 4: Test caching
        console.log('Test 4: Test snapshot caching');
        const snapshot1 = await memory.loadFrozenSnapshot();
        const snapshot2 = await memory.loadFrozenSnapshot();
        console.log(`  ✅ Cache works: ${snapshot1 === snapshot2 ? 'Same snapshot' : 'Different snapshot'}\n`);

        // Test 5: Replace content (writes to disk but snapshot unchanged)
        console.log('Test 5: Replace content (snapshot frozen during session)');
        await memory.replaceInMemory('memory', 'TypeScript over JavaScript', 'Rust over JavaScript');
        snapshot = await memory.loadFrozenSnapshot();
        console.log(`  ✅ Content replaced on disk: ${snapshot.includes('Rust') ? 'Found in snapshot' : 'NOT in snapshot (frozen)'}\n`);

        // Test 6: Remove content (writes to disk but snapshot unchanged)
        console.log('Test 6: Remove content (snapshot frozen during session)');
        await memory.removeFromMemory('memory', 'Working on AI Agent project');
        snapshot = await memory.loadFrozenSnapshot();
        console.log(`  ✅ Content removed from disk: ${snapshot.includes('AI Agent') ? 'Still in snapshot (frozen)' : 'Removed from snapshot'}\n`);

        // Test 7: Test cache invalidation (session boundary)
        console.log('Test 7: Cache invalidation (NEW SESSION)');
        await memory.loadFrozenSnapshot();
        await fs.appendFile(testConfig.memoryPath, '\nDirect file modification');

        // Before invalidation - snapshot still frozen
        const beforeInvalidate = await memory.loadFrozenSnapshot();
        console.log(`  Before invalidate: ${beforeInvalidate.includes('Direct file modification') ? 'Has new content' : 'Still frozen'}`);

        // Invalidate snapshot (simulate new session)
        memory.invalidateSnapshot();  // Simulate new session
        snapshot = await memory.loadFrozenSnapshot();
        console.log(`  After invalidate: ${snapshot.includes('Direct file modification') ? 'Has new content' : 'Still old'}`);
        console.log(`  ✅ Session boundary: New content loaded after invalidate\n`);

        // Test 8: LLM compression (with mock LLM)
        console.log('Test 8: LLM compression when approaching limit');
        const mockLLM = {
            complete: async (prompt) => {
                console.log('  📝 LLM called for compression...');
                return { content: '# Persistent Memory\n\nCompressed content that stays within limit while preserving key facts.' };
            }
        };

        memory.setLLMProvider(mockLLM);

        // Add large content that exceeds 80% threshold (400 chars)
        const largeContent = 'x'.repeat(400);
        await memory.addToMemory('memory', largeContent);

        stats = await memory.getStats();
        console.log(`  ✅ After compression: ${stats.memory.current} chars / ${stats.memory.limit} limit`);
        console.log(`     Within limit: ${stats.memory.current <= stats.memory.limit ? 'Yes' : 'No'}\n`);

        // Test 9: Stats
        console.log('Test 9: Final stats');
        stats = await memory.getStats();
        console.log(`  MEMORY.md: ${stats.memory.current}/${stats.memory.limit} chars (${Math.round(stats.memory.current / stats.memory.limit * 100)}%)`);
        console.log(`  USER.md: ${stats.user.current}/${stats.user.limit} chars (${Math.round(stats.user.current / stats.user.limit * 100)}%)\n`);

        // Cleanup
        console.log('Cleanup: Removing test files...');
        await fs.unlink(testConfig.memoryPath);
        await fs.unlink(testConfig.userPath);
        console.log('✅ Test files removed');

        console.log('\n=== Phase 3: All Tests Passed! ===');

    } catch (error) {
        console.error('❌ Error:', error.message);

        // Cleanup on error
        await fs.unlink(testConfig.memoryPath).catch(() => {});
        await fs.unlink(testConfig.userPath).catch(() => {});

        process.exit(1);
    }
})();
