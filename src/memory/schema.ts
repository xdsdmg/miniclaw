import Database from 'better-sqlite3';

export class MemorySchema {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    this.createIndexes();
    this.createTriggers();
  }

  private createTables(): void {
    // Conversations table: Track user sessions
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                -- user_id: External platform identifier (e.g., Feishu open_id)
                -- Examples:
                --   - Feishu: "ou_xxx" (from sender.sender_id.open_id)
                --   - Slack: "U1234567890" (from user.id)
                --   - CLI: "cli-user" (default for command-line usage)
                -- Purpose: Enables multi-user support and per-user memory isolation
                start_time INTEGER,
                end_time INTEGER,
                status TEXT, -- 'active', 'completed', 'error'
                metadata TEXT, -- JSON for extension
                compressed TEXT -- Compressed middle turns (for lineage)
            );
        `);

    // LLM interactions table: Store all LLM calls
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS llm_interactions (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                timestamp INTEGER,
                request_prompt TEXT,
                response_text TEXT,
                model_name TEXT,
                tokens_used INTEGER,
                cached INTEGER,
                lineage TEXT, -- Reference chain after compression
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
        `);

    // Tool executions table: Store tool execution results
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS tool_executions (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                llm_interaction_id TEXT,
                timestamp INTEGER,
                tool_name TEXT,
                tool_arguments TEXT, -- JSON
                execution_result TEXT,
                execution_time_ms INTEGER,
                success INTEGER,
                error_message TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id),
                FOREIGN KEY (llm_interaction_id) REFERENCES llm_interactions(id)
            );
        `);

    // FTS5 Virtual Table for Full-Text Search
    this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS interactions_fts USING fts5(
                interaction_id,
                content,
                tokenize='porter unicode61'
            );
        `);
  }

  private createIndexes(): void {
    this.db.exec(`
            -- Indexes for efficient querying
            CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
            CREATE INDEX IF NOT EXISTS idx_conversations_time ON conversations(start_time);
            CREATE INDEX IF NOT EXISTS idx_llm_conversation ON llm_interactions(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_tools_conversation ON tool_executions(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_tools_name ON tool_executions(tool_name);
        `);
  }

  /**
   * Create FTS5 triggers for automatic full-text search index maintenance
   *
   * What is FTS5?
   * FTS5 (Full-Text Search 5) is a SQLite extension that provides fast text search
   * using an inverted index. Unlike LIKE queries that scan every row, FTS5 uses a
   * pre-built index for O(log n) lookups.
   *
   * Why Triggers?
   * FTS5 requires two tables:
   * 1. The regular table (llm_interactions) - stores actual data
   * 2. The FTS virtual table (interactions_fts) - stores search index
   *
   * These tables must stay synchronized. Triggers automatically update the FTS
   * index whenever data is inserted/deleted from the main table.
   *
   * Example flow:
   * 1. INSERT into llm_interactions
   * 2. Trigger fires automatically
   * 3. Copies content to interactions_fts
   * 4. FTS index is updated automatically
   *
   * This means you never need to manually update interactions_fts - triggers handle it!
   */
  private createTriggers(): void {
    this.db.exec(`
            -- Trigger for inserting into FTS
            CREATE TRIGGER IF NOT EXISTS interactions_fts_insert
            AFTER INSERT ON llm_interactions BEGIN
                INSERT INTO interactions_fts(interaction_id, content)
                VALUES (new.id, new.request_prompt || ' ' || new.response_text);
            END;

            -- Trigger for deleting from FTS
            CREATE TRIGGER IF NOT EXISTS interactions_fts_delete
            AFTER DELETE ON llm_interactions BEGIN
                DELETE FROM interactions_fts WHERE interaction_id = old.id;
            END;
        `);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
