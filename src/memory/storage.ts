import Database from 'better-sqlite3';
import { MemorySchema } from './schema';

// ============================================================================
// Data Models
// ============================================================================

export interface Conversation {
    id: string;
    userId?: string;
    startTime: number;
    endTime?: number;
    status: 'active' | 'completed' | 'error';
    metadata?: Record<string, any>;
    compressed?: string;
}

export interface LLMInteraction {
    id: string;
    conversationId: string;
    timestamp: number;
    requestPrompt: string;
    responseText: string;
    modelName: string;
    tokensUsed?: number;
    cached: boolean;
    lineage?: string[];
}

export interface ToolExecution {
    id: string;
    conversationId: string;
    llmInteractionId?: string;
    timestamp: number;
    toolName: string;
    toolArguments: Record<string, any>;
    executionResult: string;
    executionTimeMs: number;
    success: boolean;
    errorMessage?: string;
}

export interface SearchResult {
    interaction: LLMInteraction;
    rank: number;
    snippet: string;
}

export interface ConversationFilter {
    userId?: string;
    status?: 'active' | 'completed' | 'error';
    startTime?: number;
    endTime?: number;
    limit?: number;
}

// ============================================================================
// Storage Class
// ============================================================================

export class MemoryStorage {
    private db: Database.Database;
    private schema: MemorySchema;

    constructor(dbPath: string) {
        this.schema = new MemorySchema(dbPath);
        this.db = this.schema.getDatabase();
    }

    // ========================================================================
    // Conversation Operations
    // ========================================================================

    createConversation(conversation: Conversation): void {
        const stmt = this.db.prepare(`
            INSERT INTO conversations (id, user_id, start_time, end_time, status, metadata, compressed)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            conversation.id,
            conversation.userId || null,
            conversation.startTime,
            conversation.endTime || null,
            conversation.status,
            conversation.metadata ? JSON.stringify(conversation.metadata) : null,
            conversation.compressed || null
        );
    }

    updateConversation(id: string, updates: Partial<Conversation>): void {
        const fields: string[] = [];
        const values: any[] = [];

        if (updates.endTime !== undefined) {
            fields.push('end_time = ?');
            values.push(updates.endTime);
        }
        if (updates.status !== undefined) {
            fields.push('status = ?');
            values.push(updates.status);
        }
        if (updates.metadata !== undefined) {
            fields.push('metadata = ?');
            values.push(JSON.stringify(updates.metadata));
        }
        if (updates.compressed !== undefined) {
            fields.push('compressed = ?');
            values.push(updates.compressed);
        }

        if (fields.length === 0) return;

        values.push(id);
        const stmt = this.db.prepare(`
            UPDATE conversations SET ${fields.join(', ')} WHERE id = ?
        `);
        stmt.run(...values);
    }

    getConversation(id: string): Conversation | null {
        const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) return null;

        return {
            id: row.id,
            userId: row.user_id,
            startTime: row.start_time,
            endTime: row.end_time,
            status: row.status,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            compressed: row.compressed
        };
    }

    listConversations(filter?: ConversationFilter): Conversation[] {
        let query = 'SELECT * FROM conversations WHERE 1=1';
        const params: any[] = [];

        if (filter?.userId) {
            query += ' AND user_id = ?';
            params.push(filter.userId);
        }
        if (filter?.status) {
            query += ' AND status = ?';
            params.push(filter.status);
        }
        if (filter?.startTime) {
            query += ' AND start_time >= ?';
            params.push(filter.startTime);
        }
        if (filter?.endTime) {
            query += ' AND start_time <= ?';
            params.push(filter.endTime);
        }

        query += ' ORDER BY start_time DESC';

        if (filter?.limit) {
            query += ' LIMIT ?';
            params.push(filter.limit);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as any[];

        return rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            startTime: row.start_time,
            endTime: row.end_time,
            status: row.status,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            compressed: row.compressed
        }));
    }

    // ========================================================================
    // LLM Interaction Operations
    // ========================================================================

    saveLLMInteraction(interaction: LLMInteraction): void {
        const stmt = this.db.prepare(`
            INSERT INTO llm_interactions (
                id, conversation_id, timestamp, request_prompt, response_text,
                model_name, tokens_used, cached, lineage
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            interaction.id,
            interaction.conversationId,
            interaction.timestamp,
            interaction.requestPrompt,
            interaction.responseText,
            interaction.modelName,
            interaction.tokensUsed || null,
            interaction.cached ? 1 : 0,
            interaction.lineage ? JSON.stringify(interaction.lineage) : null
        );
    }

    getLLMInteractions(conversationId: string): LLMInteraction[] {
        const stmt = this.db.prepare(`
            SELECT * FROM llm_interactions
            WHERE conversation_id = ?
            ORDER BY timestamp ASC
        `);
        const rows = stmt.all(conversationId) as any[];

        return rows.map(row => ({
            id: row.id,
            conversationId: row.conversation_id,
            timestamp: row.timestamp,
            requestPrompt: row.request_prompt,
            responseText: row.response_text,
            modelName: row.model_name,
            tokensUsed: row.tokens_used,
            cached: row.cached === 1,
            lineage: row.lineage ? JSON.parse(row.lineage) : undefined
        }));
    }

    // ========================================================================
    // FTS5 Full-Text Search
    // ========================================================================

    fts5Search(query: string, limit: number = 10): SearchResult[] {
        const stmt = this.db.prepare(`
            SELECT
                li.*,
                snippet(interactions_fts, 1, '<mark>', '</mark>', '...', 30) as snippet,
                bm25(interactions_fts) as rank
            FROM interactions_fts
            JOIN llm_interactions li ON interactions_fts.interaction_id = li.id
            WHERE interactions_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `);

        const rows = stmt.all(query, limit) as any[];

        return rows.map(row => ({
            interaction: {
                id: row.id,
                conversationId: row.conversation_id,
                timestamp: row.timestamp,
                requestPrompt: row.request_prompt,
                responseText: row.response_text,
                modelName: row.model_name,
                tokensUsed: row.tokens_used,
                cached: row.cached === 1,
                lineage: row.lineage ? JSON.parse(row.lineage) : undefined
            },
            rank: row.rank,
            snippet: row.snippet
        }));
    }

    // ========================================================================
    // Tool Execution Operations
    // ========================================================================

    saveToolExecution(execution: ToolExecution): void {
        const stmt = this.db.prepare(`
            INSERT INTO tool_executions (
                id, conversation_id, llm_interaction_id, timestamp,
                tool_name, tool_arguments, execution_result,
                execution_time_ms, success, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            execution.id,
            execution.conversationId,
            execution.llmInteractionId || null,
            execution.timestamp,
            execution.toolName,
            JSON.stringify(execution.toolArguments),
            execution.executionResult,
            execution.executionTimeMs,
            execution.success ? 1 : 0,
            execution.errorMessage || null
        );
    }

    getToolExecutions(conversationId: string): ToolExecution[] {
        const stmt = this.db.prepare(`
            SELECT * FROM tool_executions
            WHERE conversation_id = ?
            ORDER BY timestamp ASC
        `);
        const rows = stmt.all(conversationId) as any[];

        return rows.map(row => ({
            id: row.id,
            conversationId: row.conversation_id,
            llmInteractionId: row.llm_interaction_id,
            timestamp: row.timestamp,
            toolName: row.tool_name,
            toolArguments: JSON.parse(row.tool_arguments),
            executionResult: row.execution_result,
            executionTimeMs: row.execution_time_ms,
            success: row.success === 1,
            errorMessage: row.error_message
        }));
    }

    searchToolExecutions(toolName: string, limit?: number): ToolExecution[] {
        let query = 'SELECT * FROM tool_executions WHERE tool_name = ? ORDER BY timestamp DESC';
        const params: any[] = [toolName];

        if (limit) {
            query += ' LIMIT ?';
            params.push(limit);
        }

        const stmt = this.db.prepare(query);
        const rows = stmt.all(...params) as any[];

        return rows.map(row => ({
            id: row.id,
            conversationId: row.conversation_id,
            llmInteractionId: row.llm_interaction_id,
            timestamp: row.timestamp,
            toolName: row.tool_name,
            toolArguments: JSON.parse(row.tool_arguments),
            executionResult: row.execution_result,
            executionTimeMs: row.execution_time_ms,
            success: row.success === 1,
            errorMessage: row.error_message
        }));
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    close(): void {
        this.schema.close();
    }
}
