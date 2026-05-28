import crypto from 'crypto';
import { MemoryStorage, Conversation } from './storage';
import { PromptMemory, LLMProvider } from './prompt-memory';
import path from 'path';

// ============================================================================
// Configuration
// ============================================================================

export interface MemoryConfig {
    dbPath: string;
    memoriesDir: string;
    skillsDir: string;
    promptMemoryCharLimit?: number;
}

// ============================================================================
// Memory Manager Class
// ============================================================================

/**
 * MemoryManager: Unified Memory System Interface
 *
 * PURPOSE:
 * -------
 * MemoryManager provides a single, unified interface for the entire memory system.
 * It integrates two core components (MemoryStorage and PromptMemory) and presents
 * a clean API for higher-level components like Agent and SessionManager.
 *
 * WHY THIS UNIFIED INTERFACE?
 * ----------------------------
 * 1. Simplifies integration: Agent and SessionManager only need to interact with
 *    one class instead of managing multiple memory components separately.
 *
 * 2. Hides implementation details: The internal complexity of database operations,
 *    file I/O, and FTS5 search is encapsulated behind simple methods.
 *
 * 3. Enables lifecycle management: Conversation lifecycle (start/end) can be
 *    coordinated across all memory components in one place.
 *
 * 4. Supports dependency injection: LLM provider can be injected once and used
 *    for memory compression when needed.
 *
 * RELATIONSHIP WITH MEMORYSTORAGE AND PROMPTMEMORY:
 * -------------------------------------------------
 *
 * MemoryManager uses the DELEGATION PATTERN:
 * - It HAS-A MemoryStorage instance (this.storage)
 * - It HAS-A PromptMemory instance (this.promptMemory)
 * - It delegates calls to the appropriate component
 *
 * MemoryStorage (Phase 2):
 * - Purpose: Persistent database storage with FTS5 full-text search
 * - Stores: Conversations, LLM interactions, tool executions
 * - Characteristics:
 *   * Synchronous API (better-sqlite3)
 *   * Fast O(log n) FTS5 search
 *   * ACID guarantees with WAL mode
 * - Delegated methods:
 *   * createConversation(), getConversation(), updateConversation()
 *   * saveLLMInteraction(), getLLMInteractions(), fts5Search()
 *   * saveToolExecution(), getToolExecutions(), searchToolExecutions()
 *
 * PromptMemory (Phase 3):
 * - Purpose: Always-on prompt memory with frozen snapshot for prefix caching
 * - Stores: MEMORY.md (persistent facts), USER.md (user preferences)
 * - Characteristics:
 *   * Async API (fs/promises)
 *   * Frozen snapshot pattern (cache-friendly)
 *   * Character limit enforcement with LLM compression
 * - Delegated methods:
 *   * loadFrozenSnapshot(), addToMemory(), replaceInMemory()
 *   * removeFromMemory(), getStats()
 *   * getPromptMemory() (returns instance for snapshot management)
 *
 * USAGE EXAMPLE:
 * -------------
 * ```typescript
 * // Initialize once at application startup
 * const memoryManager = new MemoryManager({
 *     dbPath: './data/miniclaw.db',
 *     memoriesDir: '~/.miniclaw/memories',
 *     skillsDir: '~/.miniclaw/skills'
 * }, llmProvider);
 *
 * // Agent uses MemoryManager for all memory operations
 * class Agent {
 *     constructor(private memoryManager: MemoryManager) {}
 *
 *     async execute(task: string) {
 *         // Start conversation
 *         const convId = this.memoryManager.startConversation(userId);
 *
 *         // Load frozen snapshot for prefix caching
 *         const snapshot = await this.memoryManager.loadFrozenSnapshot();
 *
 *         // ... execute task ...
 *
 *         // Save interaction
 *         this.memoryManager.saveLLMInteraction(convId, ...);
 *
 *         // End conversation
 *         this.memoryManager.endConversation(convId, 'completed');
 *     }
 * }
 * ```
 *
 * ARCHITECTURE DIAGRAM:
 * -------------------
 *
 *     ┌─────────────────────────────────────────────────────┐
 *     │              MemoryManager (Unified Interface)       │
 *     │  ┌───────────────────────────────────────────────┐  │
 *     │  │  Delegates to appropriate component           │  │
 *     │  └───────────────────────────────────────────────┘  │
 *     ├──────────────────────┬───────────────────────────────┤
 *     │                      │
 *     ▼                      ▼
 * ┌──────────────────┐  ┌────────────────────────────────┐
 * │  MemoryStorage   │  │  PromptMemory                   │
 * │  (Database)      │  │  (Frozen Snapshot Files)        │
 * │                  │  │                                 │
 * │ • Conversations  │  │ • MEMORY.md (persistent facts) │
 * │ • LLM Interactions│ │ • USER.md (user preferences)   │
 * │ • Tool Executions│  │ • Prefix caching (50-70% cost) │
 * │ • FTS5 Search    │  │                                 │
 * └──────────────────┘  └────────────────────────────────┘
 */
export class MemoryManager {
    private storage: MemoryStorage;
    private promptMemory: PromptMemory;
    private llmProvider?: LLMProvider;

    constructor(config: MemoryConfig, llmProvider?: LLMProvider) {
        // Initialize MemoryStorage
        this.storage = new MemoryStorage(config.dbPath);

        // Initialize PromptMemory
        this.llmProvider = llmProvider;
        this.promptMemory = new PromptMemory({
            memoryPath: path.join(config.memoriesDir, 'MEMORY.md'),
            userPath: path.join(config.memoriesDir, 'USER.md'),
            memoryCharLimit: config.promptMemoryCharLimit || 2200,
            userCharLimit: 1375
        }, llmProvider);
    }

    // ========================================================================
    // MemoryStorage Delegation
    // ========================================================================

    /**
     * Create a new conversation
     */
    createConversation(conversation: Conversation): void {
        this.storage.createConversation(conversation);
    }

    /**
     * Update conversation
     */
    updateConversation(id: string, updates: Partial<Conversation>): void {
        this.storage.updateConversation(id, updates);
    }

    /**
     * Get conversation by ID
     */
    getConversation(id: string): Conversation | null {
        return this.storage.getConversation(id);
    }

    /**
     * List conversations with optional filters
     */
    listConversations(filter?: {
        userId?: string;
        status?: 'active' | 'completed' | 'error';
        startTime?: number;
        endTime?: number;
        limit?: number;
    }): Conversation[] {
        return this.storage.listConversations(filter);
    }

    /**
     * Save LLM interaction
     */
    saveLLMInteraction(
        conversationId: string,
        request: string,
        response: string,
        model: string,
        tokens?: number,
        cached?: boolean
    ): void {
        this.storage.saveLLMInteraction({
            id: crypto.randomUUID(),
            conversationId,
            timestamp: Date.now(),
            requestPrompt: request,
            responseText: response,
            modelName: model,
            tokensUsed: tokens,
            cached: cached || false
        });
    }

    /**
     * Get LLM interactions for a conversation
     */
    getLLMInteractions(conversationId: string): any[] {
        return this.storage.getLLMInteractions(conversationId);
    }

    /**
     * FTS5 full-text search
     */
    fts5Search(query: string, limit: number = 10): any[] {
        return this.storage.fts5Search(query, limit);
    }

    /**
     * Save tool execution
     */
    saveToolExecution(
        conversationId: string,
        toolName: string,
        args: Record<string, any>,
        result: string,
        execTime: number,
        success: boolean,
        error?: string
    ): void {
        this.storage.saveToolExecution({
            id: crypto.randomUUID(),
            conversationId,
            timestamp: Date.now(),
            toolName,
            toolArguments: args,
            executionResult: result,
            executionTimeMs: execTime,
            success,
            errorMessage: error
        });
    }

    /**
     * Get tool executions for a conversation
     */
    getToolExecutions(conversationId: string): any[] {
        return this.storage.getToolExecutions(conversationId);
    }

    /**
     * Search tool executions by name
     */
    searchToolExecutions(toolName: string, limit?: number): any[] {
        return this.storage.searchToolExecutions(toolName, limit);
    }

    // ========================================================================
    // PromptMemory Delegation
    // ========================================================================

    /**
     * Load frozen snapshot (for prefix caching)
     * Called at session start
     */
    async loadFrozenSnapshot(): Promise<string> {
        return this.promptMemory.loadFrozenSnapshot();
    }

    /**
     * Add information to MEMORY.md or USER.md
     */
    async addToMemory(category: 'memory' | 'user', content: string): Promise<void> {
        await this.promptMemory.addToMemory(category, content, this.llmProvider);
    }

    /**
     * Replace content in memory
     */
    async replaceInMemory(category: 'memory' | 'user', oldText: string, newText: string): Promise<void> {
        await this.promptMemory.replaceInMemory(category, oldText, newText);
    }

    /**
     * Remove content from memory
     */
    async removeFromMemory(category: 'memory' | 'user', text: string): Promise<void> {
        await this.promptMemory.removeFromMemory(category, text);
    }

    /**
     * Get memory statistics
     */
    async getStats(): Promise<{
        memory: { current: number; limit: number };
        user: { current: number; limit: number };
    }> {
        return this.promptMemory.getStats();
    }

    /**
     * Get PromptMemory instance
     * Provides access to loadFrozenSnapshot() and invalidateSnapshot()
     * Used by SessionManager and Agent
     */
    getPromptMemory(): PromptMemory {
        return this.promptMemory;
    }

    // ========================================================================
    // Conversation Lifecycle
    // ========================================================================

    /**
     * Start a new conversation
     */
    startConversation(userId?: string): string {
        const id = crypto.randomUUID();

        this.storage.createConversation({
            id,
            userId,
            startTime: Date.now(),
            status: 'active'
        });

        return id;
    }

    /**
     * End a conversation
     */
    endConversation(conversationId: string, status: 'completed' | 'error'): void {
        this.storage.updateConversation(conversationId, {
            endTime: Date.now(),
            status
        });
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

    /**
     * Close database connection
     */
    close(): void {
        this.storage.close();
    }

    /**
     * Check if conversation exists
     */
    hasConversation(id: string): boolean {
        return this.storage.getConversation(id) !== null;
    }
}
