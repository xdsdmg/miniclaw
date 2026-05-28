import { MemorySchema } from '../../src/memory/schema.js';
import fs from 'fs';

describe('MemorySchema', () => {
    const testDbPath = './test-memory.db';

    afterEach(() => {
        // Clean up test database and auxiliary files
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
        // Remove WAL mode auxiliary files if they exist
        if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
        if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
    });

    it('should create database with all tables', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        // Check tables exist
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all() as any[];
        const tableNames = tables.map(t => t.name);

        expect(tableNames).toContain('conversations');
        expect(tableNames).toContain('llm_interactions');
        expect(tableNames).toContain('tool_executions');
        expect(tableNames).toContain('interactions_fts');

        schema.close();
    });

    it('should have WAL mode enabled', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        const result = db.pragma('journal_mode', { simple: true });
        expect(result).toBe('wal');

        schema.close();
    });

    it('should have all indexes created', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name;").all() as any[];
        const indexNames = indexes.map(i => i.name);

        expect(indexNames).toContain('idx_conversations_user');
        expect(indexNames).toContain('idx_conversations_time');
        expect(indexNames).toContain('idx_llm_conversation');
        expect(indexNames).toContain('idx_tools_conversation');
        expect(indexNames).toContain('idx_tools_name');

        schema.close();
    });

    it('should have FTS triggers created', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name;").all() as any[];
        const triggerNames = triggers.map(t => t.name);

        expect(triggerNames).toContain('interactions_fts_insert');
        expect(triggerNames).toContain('interactions_fts_delete');

        schema.close();
    });

    it('should be able to insert and query data', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        // Insert test conversation
        const insertStmt = db.prepare(`
            INSERT INTO conversations (id, user_id, start_time, status)
            VALUES (?, ?, ?, ?)
        `);

        insertStmt.run('test-conv-1', 'user-123', Date.now(), 'active');

        // Query it back
        const selectStmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
        const row = selectStmt.get('test-conv-1') as any;

        expect(row).toBeDefined();
        expect(row.id).toBe('test-conv-1');
        expect(row.user_id).toBe('user-123');
        expect(row.status).toBe('active');

        schema.close();
    });

    it('should demonstrate FTS5 trigger functionality', () => {
        const schema = new MemorySchema(testDbPath);
        const db = schema.getDatabase();

        // First create a conversation (required for FOREIGN KEY constraint)
        const convStmt = db.prepare(`
            INSERT INTO conversations (id, user_id, start_time, status)
            VALUES (?, ?, ?, ?)
        `);
        convStmt.run('test-conv-1', 'user-test', Date.now(), 'active');

        // Insert LLM interaction
        const insertStmt = db.prepare(`
            INSERT INTO llm_interactions (id, conversation_id, timestamp, request_prompt, response_text, model_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run(
            'test-llm-1',
            'test-conv-1',
            Date.now(),
            'What is the weather in Beijing?',
            'Beijing weather is sunny and 25°C.',
            'gpt-4'
        );

        // Check if FTS index was populated by trigger
        const ftsStmt = db.prepare('SELECT * FROM interactions_fts WHERE interaction_id = ?');
        const ftsRow = ftsStmt.get('test-llm-1') as any;

        expect(ftsRow).toBeDefined();
        expect(ftsRow.content).toContain('Beijing');
        expect(ftsRow.content).toContain('weather');

        schema.close();
    });
});
