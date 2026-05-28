import { MemoryManager } from './manager';
import { logger } from '../logger';

// ============================================================================
// Data Models
// ============================================================================

export interface SessionMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
}

export interface UserSession {
    userId: string;
    messages: SessionMessage[];
    /**
     * Timestamp of last user activity (message or session access)
     * Used to detect session expiration for automatic cleanup
     * Updated on every getOrCreateSession() call
     */
    lastActivity: number;
    conversationId?: string;
    /**
     * Indicates whether the frozen snapshot has been loaded for this session
     * Ensures snapshot is loaded only once per session (for prefix caching)
     */
    snapshotLoaded: boolean;
}

export interface SessionStats {
    activeSessions: number;
    totalMessages: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface SessionManagerConfig {
    sessionTimeout: number;    // 30 minutes default
    maxMessages: number;        // 20 messages per session
    cleanupInterval: number;    // 5 minutes default
}

// ============================================================================
// Session Manager Class
// ============================================================================

export class SessionManager {
    private sessions: Map<string, UserSession> = new Map();
    private config: SessionManagerConfig;
    private memoryManager: MemoryManager;
    private cleanupInterval?: NodeJS.Timeout;

    constructor(memoryManager: MemoryManager, config?: Partial<SessionManagerConfig>) {
        this.memoryManager = memoryManager;

        const defaultConfig: SessionManagerConfig = {
            sessionTimeout: 30 * 60 * 1000,  // 30 minutes
            maxMessages: 20,
            cleanupInterval: 5 * 60 * 1000    // 5 minutes
        };

        this.config = { ...defaultConfig, ...config };

        // Start periodic cleanup
        this.startCleanup();
    }

    // ========================================================================
    // Public Methods
    // ========================================================================

    /**
     * Get or create user session
     * NOTE: This is called at the START of each user session
     */
    getOrCreateSession(userId: string): UserSession {
        let session = this.sessions.get(userId);

        if (!session) {
            session = {
                userId,
                messages: [],
                lastActivity: Date.now(),
                snapshotLoaded: false
            };
            this.sessions.set(userId, session);
            logger.info(`[SessionManager] Created session for user: ${userId}`);
        }

        // Load frozen snapshot on first access (for prefix caching)
        if (!session.snapshotLoaded) {
            // This loads MEMORY.md and USER.md once per session
            // The frozen snapshot will remain constant for the entire session
            this.memoryManager.getPromptMemory().loadFrozenSnapshot().then(snapshot => {
                logger.debug(`[SessionManager] Loaded frozen snapshot for ${userId}: ${snapshot.length} chars`);
            }).catch(error => {
                logger.error(`[SessionManager] Failed to load frozen snapshot for ${userId}:`, String(error));
            });
            session.snapshotLoaded = true;
        }

        // Update activity time
        session.lastActivity = Date.now();

        return session;
    }

    /**
     * Add message to session
     */
    addMessage(userId: string, role: 'user' | 'assistant', content: string): void {
        const session = this.getOrCreateSession(userId);
        session.messages.push({
            role,
            content,
            timestamp: Date.now()
        });

        // Limit message count (FIFO)
        if (session.messages.length > this.config.maxMessages) {
            session.messages.shift();
        }

        logger.debug(`[SessionManager] Added ${role} message for ${userId}. Session size: ${session.messages.length}`);
    }

    /**
     * Get session history
     */
    getSessionHistory(userId: string): SessionMessage[] {
        const session = this.sessions.get(userId);
        return session?.messages || [];
    }

    /**
     * Clear session (manual cleanup)
     * NOTE: This is called at the END of a user session
     */
    clearSession(userId: string): void {
        const session = this.sessions.get(userId);
        if (session && session.snapshotLoaded) {
            // Invalidate frozen snapshot so next session loads fresh content
            this.memoryManager.getPromptMemory().invalidateSnapshot();
            logger.debug(`[SessionManager] Invalidated frozen snapshot for ${userId}`);
        }

        this.sessions.delete(userId);
        logger.info(`[SessionManager] Cleared session for user: ${userId}`);
    }

    /**
     * Get session statistics
     */
    getStats(): SessionStats {
        let totalMessages = 0;
        for (const session of this.sessions.values()) {
            totalMessages += session.messages.length;
        }

        return {
            activeSessions: this.sessions.size,
            totalMessages
        };
    }

    /**
     * Check if session is expired
     */
    isSessionExpired(userId: string): boolean {
        const session = this.sessions.get(userId);
        if (!session) return true;

        const now = Date.now();
        return (now - session.lastActivity) > this.config.sessionTimeout;
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    /**
     * Periodic cleanup: persist expired sessions to database
     */
    private async cleanupAndPersist(): Promise<void> {
        const now = Date.now();
        const expiredUsers: string[] = [];

        // Find expired sessions
        for (const [userId, session] of this.sessions.entries()) {
            if (now - session.lastActivity > this.config.sessionTimeout) {
                expiredUsers.push(userId);
            }
        }

        // Persist and clear expired sessions
        for (const userId of expiredUsers) {
            const session = this.sessions.get(userId);
            if (session) {
                try {
                    // End conversation in database
                    if (session.conversationId) {
                        this.memoryManager.endConversation(
                            session.conversationId,
                            'completed'
                        );
                    }

                    // Invalidate frozen snapshot (session boundary)
                    if (session.snapshotLoaded) {
                        this.memoryManager.getPromptMemory().invalidateSnapshot();
                    }

                    this.sessions.delete(userId);
                    logger.info(`[SessionManager] Persisted and cleared session for: ${userId}`);
                } catch (error) {
                    logger.error(`[SessionManager] Error persisting session for ${userId}:`, String(error));
                }
            }
        }

        if (expiredUsers.length > 0) {
            logger.info(`[SessionManager] Cleanup complete: ${expiredUsers.length} sessions persisted`);
        }
    }

    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupAndPersist().catch(error => {
                logger.error('[SessionManager] Cleanup error:', error);
            });
        }, this.config.cleanupInterval);
    }

    // ========================================================================
    // Lifecycle
    // ========================================================================

    /**
     * Cleanup on shutdown
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Persist all active sessions
        this.cleanupAndPersist().catch(error => {
            logger.error('[SessionManager] Final cleanup error:', error);
        });
        this.sessions.clear();
    }
}
