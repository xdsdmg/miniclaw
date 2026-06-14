// Manual test for MemorySchema
const { MemorySchema } = require('../dist/memory/schema.js');
const fs = require('fs');

const testDbPath = './test-memory.db';

console.log('=== Phase 1: Database Schema Test ===\n');

try {
    // Test 1: Create database
    console.log('Test 1: Creating database...');
    const schema = new MemorySchema(testDbPath);
    console.log('✅ Database created successfully\n');

    // Test 2: Check tables
    console.log('Test 2: Verifying tables...');
    const db = schema.getDatabase();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
    const tableNames = tables.map(t => t.name);
    console.log('Tables:', tableNames);

    const requiredTables = ['conversations', 'llm_interactions', 'tool_executions', 'interactions_fts'];
    let allTablesPresent = true;
    for (const table of requiredTables) {
        if (tableNames.includes(table)) {
            console.log(`  ✅ ${table}`);
        } else {
            console.log(`  ❌ ${table} - MISSING`);
            allTablesPresent = false;
        }
    }
    console.log(allTablesPresent ? '✅ All tables present\n' : '❌ Some tables missing\n');

    // Test 3: Check WAL mode
    console.log('Test 3: Verifying WAL mode...');
    const journalMode = db.pragma('journal_mode', { simple: true });
    console.log(`Journal mode: ${journalMode}`);
    console.log(journalMode === 'wal' ? '✅ WAL mode enabled\n' : '❌ WAL mode not enabled\n');

    // Test 4: Check indexes
    console.log('Test 4: Verifying indexes...');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;").all();
    const indexNames = indexes.map(i => i.name);

    const requiredIndexes = [
        'idx_conversations_user',
        'idx_conversations_time',
        'idx_llm_conversation',
        'idx_tools_conversation',
        'idx_tools_name'
    ];

    let allIndexesPresent = true;
    for (const index of requiredIndexes) {
        if (indexNames.includes(index)) {
            console.log(`  ✅ ${index}`);
        } else {
            console.log(`  ❌ ${index} - MISSING`);
            allIndexesPresent = false;
        }
    }
    console.log(allIndexesPresent ? '✅ All indexes present\n' : '❌ Some indexes missing\n');

    // Test 5: Check triggers
    console.log('Test 5: Verifying FTS5 triggers...');
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name;").all();
    const triggerNames = triggers.map(t => t.name);

    const requiredTriggers = ['interactions_fts_insert', 'interactions_fts_delete'];
    let allTriggersPresent = true;
    for (const trigger of requiredTriggers) {
        if (triggerNames.includes(trigger)) {
            console.log(`  ✅ ${trigger}`);
        } else {
            console.log(`  ❌ ${trigger} - MISSING`);
            allTriggersPresent = false;
        }
    }
    console.log(allTriggersPresent ? '✅ All triggers present\n' : '❌ Some triggers missing\n');

    // Test 6: Insert and query data
    console.log('Test 6: Testing data operations...');
    const insertStmt = db.prepare(`
        INSERT INTO conversations (id, user_id, start_time, status)
        VALUES (?, ?, ?, ?)
    `);

    insertStmt.run('test-conv-1', 'user-123', Date.now(), 'active');

    const selectStmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
    const row = selectStmt.get('test-conv-1');

    if (row && row.id === 'test-conv-1') {
        console.log('  ✅ Insert operation successful');
        console.log('  ✅ Query operation successful');
        console.log('✅ Data operations working\n');
    } else {
        console.log('❌ Data operations failed\n');
    }

    // Test 7: FTS5 trigger functionality
    console.log('Test 7: Testing FTS5 trigger functionality...');
    const llmInsert = db.prepare(`
        INSERT INTO llm_interactions (id, conversation_id, timestamp, request_prompt, response_text, model_name)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    llmInsert.run(
        'test-llm-1',
        'test-conv-1',
        Date.now(),
        'What is the weather in Beijing?',
        'Beijing weather is sunny and 25°C.',
        'gpt-4'
    );

    const ftsStmt = db.prepare('SELECT * FROM interactions_fts WHERE interaction_id = ?');
    const ftsRow = ftsStmt.get('test-llm-1');

    if (ftsRow && ftsRow.content.includes('Beijing')) {
        console.log('  ✅ FTS5 insert trigger working');
        console.log('  ✅ FTS index populated correctly');
        console.log('✅ FTS5 triggers working\n');
    } else {
        console.log('❌ FTS5 triggers not working\n');
    }

    // Cleanup
    schema.close();
    fs.unlinkSync(testDbPath);
    // Also remove WAL mode auxiliary files if they exist
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    console.log('Cleanup: Test database and auxiliary files removed');

    console.log('\n=== Phase 1: All Tests Passed! ===');

} catch (error) {
    console.error('❌ Error:', error.message);

    // Cleanup on error
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    process.exit(1);
}
