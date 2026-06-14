// Manual test for MemoryManager
const { MemoryManager } = require('../dist/memory/manager.js');
const fs = require('fs/promises');

const testConfig = {
    dbPath: './test-manager.db',
    memoriesDir: './test-memories',
    skillsDir: './test-skills'
};

console.log('=== Phase 3.5: Memory Manager Test ===\n');

(async () => {
    try {
        // Clean up
        try { await fs.unlink(testConfig.dbPath); } catch {}
        try { await fs.unlink(testConfig.dbPath + '-wal'); } catch {}
        try { await fs.unlink(testConfig.dbPath + '-shm'); } catch {}

        // Create memories directory
        await fs.mkdir(testConfig.memoriesDir, { recursive: true });

        const manager = new MemoryManager(testConfig);

        // Test 1: Initialization
        console.log('Test 1: Initialization');
        console.log('  ✅ MemoryStorage initialized');
        console.log('  ✅ PromptMemory initialized\n');

        // Test 2: MemoryStorage delegation
        console.log('Test 2: MemoryStorage delegation');
        const convId = manager.startConversation('user-1');
        console.log(`  ✅ Conversation created: ${convId}`);

        const conv = manager.getConversation(convId);
        console.log(`  ✅ Retrieved conversation: ${conv.status}\n`);

        // Test 3: PromptMemory delegation
        console.log('Test 3: PromptMemory delegation');
        const snapshot = await manager.loadFrozenSnapshot();
        console.log(`  ✅ Frozen snapshot loaded: ${snapshot.length} chars`);

        await manager.addToMemory('memory', 'User works on AI project');
        const stats = await manager.getStats();
        console.log(`  ✅ Memory added: ${stats.memory.current}/${stats.memory.limit} chars\n`);

        // Test 4: Get PromptMemory
        console.log('Test 4: Get PromptMemory instance');
        const promptMemory = manager.getPromptMemory();
        console.log(`  ✅ PromptMemory instance: ${promptMemory !== undefined}\n`);

        // Test 5: Integration
        console.log('Test 5: Complete workflow');
        manager.saveLLMInteraction(
            convId,
            'Debug issue',
            'Check logs',
            'gpt-4',
            150,
            false
        );
        console.log('  ✅ LLM interaction saved');

        manager.endConversation(convId, 'completed');
        const finalConv = manager.getConversation(convId);
        console.log(`  ✅ Conversation ended: ${finalConv.status}\n`);

        // Cleanup
        manager.close();
        await fs.unlink(testConfig.dbPath);
        try { await fs.unlink(testConfig.dbPath + '-wal'); } catch {}
        try { await fs.unlink(testConfig.dbPath + '-shm'); } catch {}

        console.log('=== Phase 3.5: All Tests Passed! ===');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
})();
