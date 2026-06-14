// Manual test for MemoryStorage - Tests ALL methods
const { MemoryStorage } = require('../dist/memory/storage.js');
const fs = require('fs');

const testDbPath = './test-storage-manual.db';

console.log('=== Phase 2: Memory Storage Layer Test ===\n');

try {
    // Initialize storage
    console.log('Initializing MemoryStorage...');
    const storage = new MemoryStorage(testDbPath);
    console.log('✅ Storage initialized\n');

    // ============================================================================
    // Test 1: Conversation Operations
    // ============================================================================
    console.log('--- Test 1: Conversation Operations ---\n');

    // Test 1.1: createConversation
    console.log('Test 1.1: createConversation');
    storage.createConversation({
        id: 'conv-1',
        userId: 'user-123',
        startTime: Date.now(),
        status: 'active',
        metadata: { source: 'cli', tags: ['test'] }
    });
    console.log('  ✅ Conversation created\n');

    // Test 1.2: getConversation
    console.log('Test 1.2: getConversation');
    const conv = storage.getConversation('conv-1');
    console.log(`  ✅ Retrieved conversation: ${conv.id}`);
    console.log(`     - User ID: ${conv.userId}`);
    console.log(`     - Status: ${conv.status}`);
    console.log(`     - Metadata: ${JSON.stringify(conv.metadata)}\n`);

    // Test 1.3: updateConversation
    console.log('Test 1.3: updateConversation');
    storage.updateConversation('conv-1', {
        status: 'completed',
        endTime: Date.now(),
        compressed: 'compressed data'
    });
    const updatedConv = storage.getConversation('conv-1');
    console.log(`  ✅ Updated conversation:`);
    console.log(`     - Status: ${updatedConv.status}`);
    console.log(`     - End time: ${updatedConv.endTime}`);
    console.log(`     - Compressed: ${updatedConv.compressed}\n`);

    // Test 1.4: listConversations (no filter)
    console.log('Test 1.4: listConversations (no filter)');
    storage.createConversation({
        id: 'conv-2',
        userId: 'user-456',
        startTime: Date.now() - 1000,
        status: 'active'
    });
    const allConvs = storage.listConversations();
    console.log(`  ✅ Listed all conversations: ${allConvs.length} conversations\n`);

    // Test 1.5: listConversations (with filter)
    console.log('Test 1.5: listConversations (with filter)');
    const userConvs = storage.listConversations({ userId: 'user-123', status: 'completed' });
    console.log(`  ✅ Filtered conversations: ${userConvs.length} conversation(s)\n`);

    // Test 1.6: getConversation (non-existent)
    console.log('Test 1.6: getConversation (non-existent)');
    const nonExistent = storage.getConversation('non-existent');
    console.log(`  ✅ Non-existent conversation returns: ${nonExistent}\n`);

    // ============================================================================
    // Test 2: LLM Interaction Operations
    // ============================================================================
    console.log('--- Test 2: LLM Interaction Operations ---\n');

    // Test 2.1: saveLLMInteraction
    console.log('Test 2.1: saveLLMInteraction');
    storage.saveLLMInteraction({
        id: 'llm-1',
        conversationId: 'conv-1',
        timestamp: Date.now(),
        requestPrompt: 'What is the weather in Beijing?',
        responseText: 'Beijing weather is sunny and 25°C.',
        modelName: 'gpt-4',
        tokensUsed: 150,
        cached: false,
        lineage: ['msg-1', 'msg-2']
    });
    console.log('  ✅ LLM interaction saved\n');

    // Test 2.2: getLLMInteractions
    console.log('Test 2.2: getLLMInteractions');
    const interactions = storage.getLLMInteractions('conv-1');
    console.log(`  ✅ Retrieved ${interactions.length} interaction(s):`);
    console.log(`     - Prompt: ${interactions[0].requestPrompt.substring(0, 50)}...`);
    console.log(`     - Model: ${interactions[0].modelName}`);
    console.log(`     - Tokens: ${interactions[0].tokensUsed}`);
    console.log(`     - Cached: ${interactions[0].cached}`);
    console.log(`     - Lineage: ${JSON.stringify(interactions[0].lineage)}\n`);

    // ============================================================================
    // Test 3: FTS5 Full-Text Search
    // ============================================================================
    console.log('--- Test 3: FTS5 Full-Text Search ---\n');

    // Test 3.1: fts5Search (single word)
    console.log('Test 3.1: fts5Search (single word)');
    const results1 = storage.fts5Search('Beijing', 5);
    console.log(`  ✅ Search for "Beijing": ${results1.length} result(s)`);
    if (results1.length > 0) {
        console.log(`     - Snippet: ${results1[0].snippet.substring(0, 80)}...`);
        console.log(`     - Rank (BM25): ${results1[0].rank.toFixed(4)}`);
    }
    console.log('');

    // Test 3.2: fts5Search (multiple words)
    console.log('Test 3.2: fts5Search (multiple words)');
    const results2 = storage.fts5Search('weather sunny', 5);
    console.log(`  ✅ Search for "weather sunny": ${results2.length} result(s)\n`);

    // Test 3.3: fts5Search (limit)
    console.log('Test 3.3: fts5Search (with limit)');
    storage.saveLLMInteraction({
        id: 'llm-2',
        conversationId: 'conv-1',
        timestamp: Date.now(),
        requestPrompt: 'Debug Python code',
        responseText: 'Python debugging tips',
        modelName: 'gpt-4',
        cached: false
    });
    storage.saveLLMInteraction({
        id: 'llm-3',
        conversationId: 'conv-1',
        timestamp: Date.now(),
        requestPrompt: 'Debug JavaScript code',
        responseText: 'JavaScript debugging tips',
        modelName: 'gpt-4',
        cached: false
    });
    const results3 = storage.fts5Search('debug', 1);
    console.log(`  ✅ Search for "debug" (limit=1): ${results3.length} result(s)\n`);

    // ============================================================================
    // Test 4: Tool Execution Operations
    // ============================================================================
    console.log('--- Test 4: Tool Execution Operations ---\n');

    // Test 4.1: saveToolExecution (successful)
    console.log('Test 4.1: saveToolExecution (successful)');
    storage.saveToolExecution({
        id: 'tool-1',
        conversationId: 'conv-1',
        llmInteractionId: 'llm-1',
        timestamp: Date.now(),
        toolName: 'Read',
        toolArguments: { file_path: '/path/to/file.txt' },
        executionResult: 'File content here',
        executionTimeMs: 100,
        success: true
    });
    console.log('  ✅ Successful tool execution saved\n');

    // Test 4.2: saveToolExecution (failed)
    console.log('Test 4.2: saveToolExecution (failed)');
    storage.saveToolExecution({
        id: 'tool-2',
        conversationId: 'conv-1',
        timestamp: Date.now(),
        toolName: 'Write',
        toolArguments: { file_path: '/readonly/file.txt', content: 'test' },
        executionResult: '',
        executionTimeMs: 50,
        success: false,
        errorMessage: 'Permission denied'
    });
    console.log('  ✅ Failed tool execution saved\n');

    // Test 4.3: getToolExecutions
    console.log('Test 4.3: getToolExecutions');
    const toolExecutions = storage.getToolExecutions('conv-1');
    console.log(`  ✅ Retrieved ${toolExecutions.length} tool execution(s):`);
    toolExecutions.forEach((exec, i) => {
        console.log(`     [${i + 1}] ${exec.toolName} - Success: ${exec.success}, Time: ${exec.executionTimeMs}ms`);
        if (!exec.success) {
            console.log(`         Error: ${exec.errorMessage}`);
        }
    });
    console.log('');

    // Test 4.4: searchToolExecutions
    console.log('Test 4.4: searchToolExecutions');
    storage.saveToolExecution({
        id: 'tool-3',
        conversationId: 'conv-1',
        timestamp: Date.now(),
        toolName: 'Read',
        toolArguments: { file_path: 'another.txt' },
        executionResult: 'More content',
        executionTimeMs: 75,
        success: true
    });
    const readExecutions = storage.searchToolExecutions('Read');
    console.log(`  ✅ Search for "Read" tool: ${readExecutions.length} execution(s)\n`);

    // Test 4.5: searchToolExecutions (with limit)
    console.log('Test 4.5: searchToolExecutions (with limit)');
    const limitedResults = storage.searchToolExecutions('Read', 1);
    console.log(`  ✅ Search for "Read" (limit=1): ${limitedResults.length} execution(s)\n`);

    // ============================================================================
    // Test 5: Utility Methods
    // ============================================================================
    console.log('--- Test 5: Utility Methods ---\n');

    // Test 5.1: close
    console.log('Test 5.1: close');
    storage.close();
    console.log('  ✅ Database connection closed\n');

    // ============================================================================
    // Summary
    // ============================================================================
    console.log('=== Phase 2: All Methods Tested Successfully! ===\n');
    console.log('Summary:');
    console.log('  ✅ createConversation');
    console.log('  ✅ getConversation');
    console.log('  ✅ updateConversation');
    console.log('  ✅ listConversations');
    console.log('  ✅ saveLLMInteraction');
    console.log('  ✅ getLLMInteractions');
    console.log('  ✅ fts5Search');
    console.log('  ✅ saveToolExecution');
    console.log('  ✅ getToolExecutions');
    console.log('  ✅ searchToolExecutions');
    console.log('  ✅ close');

    // Cleanup
    console.log('\nCleanup: Removing test database files...');
    fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    console.log('✅ Test database removed');

} catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);

    // Cleanup on error
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');

    process.exit(1);
}
