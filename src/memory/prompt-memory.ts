import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Configuration
// ============================================================================

export interface PromptMemoryConfig {
    memoryPath: string;         // ~/.miniclaw/memories/MEMORY.md
    userPath: string;           // ~/.miniclaw/memories/USER.md
    memoryCharLimit: number;    // 2,200 chars (~800 tokens)
    userCharLimit: number;      // 1,375 chars (~500 tokens)
}

// ============================================================================
// Data Models
// ============================================================================

export interface MemoryStats {
    memory: { current: number; limit: number };
    user: { current: number; limit: number };
}

export interface FrozenSnapshot {
    memory: string;
    user: string;
    loadedAt: number;
}

export interface LLMProvider {
    complete(prompt: string): Promise<{ content: string }>;
}

// ============================================================================
// Prompt Memory Class
// ============================================================================

export class PromptMemory {
    private config: PromptMemoryConfig;
    private frozenSnapshot?: FrozenSnapshot;
    private llmProvider?: LLMProvider;

    constructor(
        config?: Partial<PromptMemoryConfig>,
        llmProvider?: LLMProvider
    ) {
        const defaultConfig: PromptMemoryConfig = {
            memoryPath: path.join(os.homedir(), '.miniclaw/memories/MEMORY.md'),
            userPath: path.join(os.homedir(), '.miniclaw/memories/USER.md'),
            memoryCharLimit: 2200,
            userCharLimit: 1375
        };

        this.config = { ...defaultConfig, ...config };
        this.llmProvider = llmProvider;
        this.ensureDirectories();
        this.initializeDefaultFiles();
    }

    /**
     * Set LLM provider for intelligent memory compression
     */
    setLLMProvider(llmProvider: LLMProvider): void {
        this.llmProvider = llmProvider;
    }

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Load frozen snapshot at session start (for provider caching)
     * This is called ONCE per session to enable prefix caching
     */
    async loadFrozenSnapshot(): Promise<string> {
        // Return cached snapshot if available
        if (this.frozenSnapshot) {
            return this.formatSnapshot(this.frozenSnapshot);
        }

        // Read files
        const memoryContent = await this.readAndTrim(this.config.memoryPath);
        const userContent = await this.readAndTrim(this.config.userPath);

        // Cache snapshot
        this.frozenSnapshot = {
            memory: memoryContent,
            user: userContent,
            loadedAt: Date.now()
        };

        return this.formatSnapshot(this.frozenSnapshot);
    }

    /**
     * Add information to memory with intelligent integration
     * NOTE: Persists to disk immediately but doesn't affect current session
     * Changes appear in next session (preserves prefix cache)
     *
     * Integration Strategy:
     * - If within 80% of limit: append directly
     * - If over 80% of limit: use LLM to compress and merge content
     * - This prevents limit errors and maintains memory quality
     *
     * IMPORTANT: Does NOT invalidate frozen snapshot - changes only appear in NEXT session
     */
    async addToMemory(
        category: 'memory' | 'user',
        content: string,
        llmProvider?: LLMProvider
    ): Promise<void> {
        const filePath = category === 'memory' ? this.config.memoryPath : this.config.userPath;
        const charLimit = category === 'memory' ? this.config.memoryCharLimit : this.config.userCharLimit;

        const existing = await this.readAndTrim(filePath);
        const newContent = existing ? `${existing}\n${content}` : content;

        // Check if we need compression (80% threshold)
        const COMPRESSION_THRESHOLD = 0.8;
        if (newContent.length <= charLimit * COMPRESSION_THRESHOLD) {
            // Direct append - under threshold
            await fs.writeFile(filePath, newContent, 'utf-8');
        } else if (this.llmProvider || llmProvider) {
            // Use LLM to compress and merge
            const provider = llmProvider || this.llmProvider;
            if (provider) {
                const compressed = await this.compressWithLLM(category, existing, content, charLimit, provider);
                await fs.writeFile(filePath, compressed, 'utf-8');
            }
        } else {
            // No LLM available - warn user
            console.warn(
                `${category.toUpperCase()} approaching limit (${newContent.length}/${charLimit} chars). ` +
                `Consider reducing content or provide LLM provider for automatic compression.`
            );
            await fs.writeFile(filePath, newContent, 'utf-8');
        }

        // ❌ DO NOT invalidate snapshot - frozen snapshot stays constant during session
        // Changes will appear in NEXT session when loadFrozenSnapshot() is called fresh
    }

    /**
     * Replace existing content in memory
     * NOTE: Changes persist to disk but frozen snapshot is NOT invalidated
     * Changes appear in next session (preserves prefix cache)
     */
    async replaceInMemory(category: 'memory' | 'user', oldText: string, newText: string): Promise<void> {
        const filePath = category === 'memory' ? this.config.memoryPath : this.config.userPath;
        const content = await fs.readFile(filePath, 'utf-8');

        if (!content.includes(oldText)) {
            throw new Error(`Old text not found in ${category} file`);
        }

        const updated = content.replace(oldText, newText);
        await fs.writeFile(filePath, updated, 'utf-8');

        // ❌ DO NOT invalidate snapshot - frozen snapshot stays constant during session
    }

    /**
     * Remove content from memory
     * NOTE: Changes persist to disk but frozen snapshot is NOT invalidated
     * Changes appear in next session (preserves prefix cache)
     */
    async removeFromMemory(category: 'memory' | 'user', text: string): Promise<void> {
        const filePath = category === 'memory' ? this.config.memoryPath : this.config.userPath;
        const content = await fs.readFile(filePath, 'utf-8');

        if (!content.includes(text)) {
            throw new Error(`Text not found in ${category} file`);
        }

        const updated = content.replace(text, '').replace(/\n{3,}/g, '\n\n');
        await fs.writeFile(filePath, updated, 'utf-8');

        // ❌ DO NOT invalidate snapshot - frozen snapshot stays constant during session
    }

    /**
     * Get current memory stats
     */
    async getStats(): Promise<MemoryStats> {
        const memoryContent = await this.readAndTrim(this.config.memoryPath);
        const userContent = await this.readAndTrim(this.config.userPath);

        return {
            memory: {
                current: memoryContent.length,
                limit: this.config.memoryCharLimit
            },
            user: {
                current: userContent.length,
                limit: this.config.userCharLimit
            }
        };
    }

    /**
     * Invalidate cached snapshot (for session restart or testing)
     *
     * IMPORTANT: This should ONLY be called when:
     * 1. Starting a NEW session (e.g., new user conversation)
     * 2. Testing scenarios
     *
     * DO NOT call this during an active session as it breaks prefix caching!
     */
    invalidateSnapshot(): void {
        this.frozenSnapshot = undefined;
    }

    /**
     * Get the timestamp when the snapshot was loaded
     * Useful for debugging and monitoring cache age
     */
    getSnapshotAge(): number | null {
        if (!this.frozenSnapshot) return null;
        return Date.now() - this.frozenSnapshot.loadedAt;
    }

    /**
     * Check if snapshot is currently cached
     */
    hasSnapshot(): boolean {
        return this.frozenSnapshot !== undefined;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Compress and merge memory content using LLM
     * This maintains memory quality while staying within character limits
     */
    private async compressWithLLM(
        category: 'memory' | 'user',
        existing: string,
        newContent: string,
        charLimit: number,
        llmProvider: LLMProvider
    ): Promise<string> {
        const prompt = `You are managing a ${category} file with a strict ${charLimit} character limit.

Current content (${existing.length} chars):
${existing}

New content to add:
${newContent}

Task: Merge and compress the content to stay within ${charLimit} characters while:
1. Preserving the most important information
2. Removing redundancy and outdated details
3. Maintaining markdown formatting
4. Keeping the structure organized

Return ONLY the merged content (no explanations, no meta-commentary).`;

        const response = await llmProvider.complete(prompt);
        let compressed = response.content.trim();

        // Safety check: if still over limit, truncate
        if (compressed.length > charLimit) {
            console.warn(`LLM compression still exceeds limit, truncating...`);
            compressed = compressed.substring(0, charLimit - 100) + '\n\n[Content truncated due to length...]';
        }

        return compressed;
    }

    private formatSnapshot(snapshot: FrozenSnapshot): string {
        let result = '';

        // MEMORY.md (frozen)
        if (snapshot.memory) {
            result += `## Persistent Memory\n\n${snapshot.memory}\n\n`;
        }

        // USER.md (frozen)
        if (snapshot.user) {
            result += `## User Profile\n\n${snapshot.user}\n\n`;
        }

        return result;
    }

    private async readAndTrim(filePath: string): Promise<string> {
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return '';
        }
    }

    private ensureDirectories(): void {
        const dir = path.dirname(this.config.memoryPath);
        fsSync.mkdirSync(dir, { recursive: true });
    }

    /**
     * Initialize default memory files if they don't exist
     */
    private async initializeDefaultFiles(): Promise<void> {
        // MEMORY.md
        const memoryPath = this.config.memoryPath;
        try {
            await fs.readFile(memoryPath, 'utf-8');
        } catch {
            // File doesn't exist, create default
            await fs.writeFile(memoryPath, `# Persistent Memory

This file stores facts and information that should persist across all conversations.

## Guidelines

- Keep entries concise and factual
- Remove outdated information periodically
- Maximum 2,200 characters

---
`, 'utf-8');
        }

        // USER.md
        const userPath = this.config.userPath;
        try {
            await fs.readFile(userPath, 'utf-8');
        } catch {
            // File doesn't exist, create default
            await fs.writeFile(userPath, `# User Profile

This file stores preferences and information about you.

## Guidelines

- Track your communication preferences
- Note your domain knowledge and expertise
- Maximum 1,375 characters

---
`, 'utf-8');
        }
    }
}
