import { logger } from '../logger';

// ============================================================================
// Hook Context Types
// ============================================================================

/**
 * Union type of all hook context types.
 * Each hook point has its own context type with specific fields.
 *
 * Hook Execution Flow:
 * 1. beforeExecute → Called before agent execution starts
 * 2. afterStableContext → Called after building stable context (system prompt + frozen memory)
 * 3. afterDynamicContext → Called after building dynamic context (search results + skills)
 * 4. beforeLLMCall → Called before each LLM API call
 * 5. afterLLMCall → Called after each LLM API response
 * 6. beforeToolCall → Called before each tool execution
 * 7. afterToolCall → Called after each tool execution
 * 8. afterExecute → Called after agent execution completes (success)
 * 9. onError → Called when any error occurs during execution
 */
export type HookContext =
    | BeforeExecuteContext
    | AfterStableContextContext
    | AfterDynamicContextContext
    | BeforeLLMCallContext
    | AfterLLMCallContext
    | BeforeToolCallContext
    | AfterToolCallContext
    | AfterExecuteContext
    | OnErrorContext;

/**
 * Context for beforeExecute hook.
 * Called at the very start of agent execution, before any processing.
 *
 * Use cases:
 * - Start conversation tracking
 * - Initialize per-request state
 * - Log execution start
 *
 * Modifiable fields:
 * - conversationId: Can be set to link to memory system
 * - Any custom properties via [key: string]: any
 */
export interface BeforeExecuteContext {
    taskId: string;
    userId?: string;
    task: string;
    timestamp: number;
    conversationId?: string;  // Can be set by hooks
    [key: string]: any;
}

/**
 * Context for afterStableContext hook.
 * Called after building stable context (system prompt + frozen memory snapshot).
 *
 * Stable context includes:
 * - System prompt
 * - MEMORY.md (frozen, cached)
 * - USER.md (frozen, cached)
 * - Skill index (names only, cached)
 *
 * Use cases:
 * - Add session history to context
 * - Modify stable context for specific users
 * - Inject user-specific static context
 *
 * Modifiable fields:
 * - context: Can be appended to (e.g., add session history)
 */
export interface AfterStableContextContext {
    taskId: string;
    userId?: string;
    task: string;
    context: string;           // MODIFIABLE - Hooks can append content
    contextType: 'stable';
    tokenCount: number;
    cached: boolean;           // Indicates if stable context is cache-optimized
    [key: string]: any;
}

/**
 * Context for afterDynamicContext hook.
 * Called after building dynamic context (task-specific content).
 *
 * Dynamic context includes:
 * - FTS5 search results (summarized)
 * - Relevant skills (full content, on-demand)
 * - Task-specific context
 *
 * Use cases:
 * - Add search results to context
 * - Add relevant skills to context
 * - Modify dynamic context based on task
 *
 * Modifiable fields:
 * - context: Can be appended to (e.g., add search results, skills)
 */
export interface AfterDynamicContextContext {
    taskId: string;
    userId?: string;
    task: string;
    context: string;           // MODIFIABLE - Hooks can append content
    contextType: 'dynamic';
    tokenCount: number;
    [key: string]: any;
}

/**
 * Context for beforeLLMCall hook.
 * Called before each LLM API call.
 *
 * Use cases:
 * - Log request details (model, tokens)
 * - Modify messages before sending
 * - Preflight compression check
 * - Add request metadata
 *
 * Modifiable fields:
 * - messages: Can be modified (e.g., compression, filtering)
 */
export interface BeforeLLMCallContext {
    taskId: string;
    conversationId?: string;
    messages: any[];           // MODIFIABLE - Hooks can modify messages
    model: string;
    estimatedTokens: number;
    [key: string]: any;
}

/**
 * Context for afterLLMCall hook.
 * Called after each LLM API response.
 *
 * Use cases:
 * - Record LLM interaction to database
 * - Track latency and costs
 * - Monitor cache hit rate
 * - Log response details
 *
 * Read-only fields (for informational purposes):
 * - All fields are read-only, hooks should only observe
 */
export interface AfterLLMCallContext {
    taskId: string;
    conversationId?: string;
    requestMessages: any[];
    response: any;            // Contains content, model, usage, cached status
    duration: number;
    cached: boolean;
    success: boolean;
    [key: string]: any;
}

/**
 * Context for beforeToolCall hook.
 * Called before each tool execution.
 *
 * Use cases:
 * - Log tool execution start
 * - Validate tool arguments
 * - Modify tool arguments before execution
 * - Start execution timer
 *
 * Modifiable fields:
 * - toolArguments: Can be modified (e.g., validation, transformation)
 */
export interface BeforeToolCallContext {
    taskId: string;
    conversationId?: string;
    toolName: string;
    toolArguments: Record<string, any>;  // MODIFIABLE - Hooks can modify arguments
    timestamp: number;
    [key: string]: any;
}

/**
 * Context for afterToolCall hook.
 * Called after each tool execution.
 *
 * Use cases:
 * - Record tool execution to database
 * - Track execution time
 * - Track success/failure rates
 * - Log result details
 * - Track errors for learning triggers
 *
 * Read-only fields (for informational purposes):
 * - All fields are read-only, hooks should only observe
 */
export interface AfterToolCallContext {
    taskId: string;
    conversationId?: string;
    toolName: string;
    toolArguments: Record<string, any>;
    result: any;              // Contains output, error, success
    duration: number;
    success: boolean;
    errorMessage?: string;
    [key: string]: any;
}

/**
 * Context for afterExecute hook.
 * Called after agent execution completes successfully.
 *
 * Use cases:
 * - Check learning triggers (complex task, error recovery, user correction)
 * - End conversation in database
 * - Log completion details
 * - Record final statistics
 *
 * Read-only fields (for informational purposes):
 * - All fields are read-only, hooks should only observe
 */
export interface AfterExecuteContext {
    taskId: string;
    userId?: string;
    conversationId?: string;
    task: string;
    result: string;
    duration: number;
    success: boolean;
    turnCount: number;        // Number of conversation turns
    toolCallCount: number;    // Number of tools executed
    [key: string]: any;
}

/**
 * Context for onError hook.
 * Called when any error occurs during agent execution.
 *
 * Use cases:
 * - End conversation with error status
 * - Log error details
 * - Send error notifications
 * - Cleanup resources
 *
 * Error phases:
 * - 'llm': LLM API call failed
 * - 'tool': Tool execution failed
 * - 'context': Context building failed
 * - 'unknown': Unknown error
 *
 * Read-only fields (for informational purposes):
 * - All fields are read-only, hooks should only observe
 */
export interface OnErrorContext {
    taskId: string;
    conversationId?: string;
    error: Error;
    phase: 'llm' | 'tool' | 'context' | 'unknown';
    context?: any;            // Additional context about the error
    [key: string]: any;
}

// ============================================================================
// Hook Handler
// ============================================================================

export interface HookHandler<TContext extends HookContext = HookContext> {
    id: string;
    name: string;
    priority: number;
    handler: (context: TContext) => void | Promise<void>;
}

// ============================================================================
// Hook Manager Interface
// ============================================================================

export interface HookManager {
    /**
     * Register a hook handler
     * @param hookName - Name of the hook point
     * @param handler - Handler function with metadata
     */
    register<TContext extends HookContext>(
        hookName: string,
        handler: HookHandler<TContext>
    ): void;

    /**
     * Unregister a hook handler
     * @param hookName - Name of the hook point
     * @param handlerId - ID of the handler to remove
     */
    unregister(hookName: string, handlerId: string): boolean;

    /**
     * Execute all handlers for a hook (synchronous)
     * Handlers are executed in priority order (lower number first)
     * @param hookName - Name of the hook point
     * @param context - Context object (can be modified by handlers)
     */
    execute<TContext extends HookContext>(
        hookName: string,
        context: TContext
    ): void;

    /**
     * Execute all handlers for a hook (asynchronous)
     * Handlers are executed sequentially in priority order
     * @param hookName - Name of the hook point
     * @param context - Context object (can be modified by handlers)
     */
    executeAsync<TContext extends HookContext>(
        hookName: string,
        context: TContext
    ): Promise<void>;

    /**
     * Get all registered handlers for a hook
     * @param hookName - Name of the hook point
     */
    getHandlers<TContext extends HookContext>(
        hookName: string
    ): HookHandler<TContext>[];

    /**
     * Check if a hook has any handlers registered
     * @param hookName - Name of the hook point
     */
    hasHandlers(hookName: string): boolean;
}

// ============================================================================
// Hook Names
// ============================================================================

/**
 * Registry of all available hook points in the agent execution flow.
 *
 * Each hook point represents a specific moment in the execution lifecycle
 * where plugins can observe or modify behavior.
 *
 * Hook Execution Order:
 * 1. beforeExecute - Execution starts
 * 2. afterStableContext - Stable context built (cached)
 * 3. afterDynamicContext - Dynamic context built (per-turn)
 * 4. beforeLLMCall - Before each LLM call
 * 5. afterLLMCall - After each LLM response
 * 6. beforeToolCall - Before each tool execution
 * 7. afterToolCall - After each tool execution
 * 8. afterExecute - Execution completes successfully
 * 9. onError - Any error occurs
 *
 * Priority Guidelines:
 * - 0-20: Core system hooks (Memory, Session)
 * - 20-50: Monitoring and metrics
 * - 50-100: Logging and debugging
 */
export const HOOKS = {
    /**
     * beforeExecute: Called at the start of agent execution.
     * Use for: Starting conversations, initializing state, logging start.
     * Priority: 10 (Memory), 50 (Logger)
     */
    BEFORE_EXECUTE: 'beforeExecute',

    /**
     * afterStableContext: Called after building stable (cached) context.
     * Use for: Adding session history, user-specific static context.
     * Priority: 10 (Memory), 20 (Cache), 50 (Logger)
     */
    AFTER_STABLE_CONTEXT: 'afterStableContext',

    /**
     * afterDynamicContext: Called after building dynamic (per-turn) context.
     * Use for: Adding search results, relevant skills, task-specific context.
     * Priority: 10 (Memory), 50 (Logger)
     */
    AFTER_DYNAMIC_CONTEXT: 'afterDynamicContext',

    /**
     * beforeLLMCall: Called before each LLM API call.
     * Use for: Preflight checks, request logging, token estimation.
     * Priority: 20 (Monitor), 50 (Logger)
     */
    BEFORE_LLM_CALL: 'beforeLLMCall',

    /**
     * afterLLMCall: Called after each LLM API response.
     * Use for: Recording interaction, tracking metrics, cost monitoring.
     * Priority: 10 (Memory), 20 (Monitor), 50 (Logger)
     */
    AFTER_LLM_CALL: 'afterLLMCall',

    /**
     * beforeToolCall: Called before each tool execution.
     * Use for: Argument validation, execution timing, logging.
     * Priority: 20 (Monitor), 50 (Logger)
     */
    BEFORE_TOOL_CALL: 'beforeToolCall',

    /**
     * afterToolCall: Called after each tool execution.
     * Use for: Recording execution, tracking success rates, error tracking.
     * Priority: 10 (Memory), 20 (Monitor), 50 (Logger)
     */
    AFTER_TOOL_CALL: 'afterToolCall',

    /**
     * afterExecute: Called after successful agent execution completion.
     * Use for: Learning triggers, ending conversations, final metrics.
     * Priority: 10 (Memory), 20 (Monitor), 50 (Logger)
     */
    AFTER_EXECUTE: 'afterExecute',

    /**
     * onError: Called when any error occurs during execution.
     * Use for: Error handling, cleanup, notifications, ending conversations.
     * Priority: 10 (Memory), 50 (Logger)
     */
    ON_ERROR: 'onError'
} as const;

export type HookName = typeof HOOKS[keyof typeof HOOKS];

// ============================================================================
// Hook Manager Implementation
// ============================================================================

export class HookManagerImpl implements HookManager {
    private hooks: Map<string, HookHandler[]> = new Map();

    register<TContext extends HookContext>(
        hookName: string,
        handler: HookHandler<TContext>
    ): void {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }

        const handlers = this.hooks.get(hookName)!;
        handlers.push(handler as HookHandler);

        // Sort by priority (lower numbers first)
        handlers.sort((a, b) => a.priority - b.priority);

        logger.info(`[HookManager] Registered "${handler.id}" for "${hookName}" (priority: ${handler.priority})`);
    }

    unregister(hookName: string, handlerId: string): boolean {
        if (!this.hooks.has(hookName)) {
            return false;
        }

        const handlers = this.hooks.get(hookName)!;
        const index = handlers.findIndex(h => h.id === handlerId);

        if (index === -1) {
            return false;
        }

        handlers.splice(index, 1);

        if (handlers.length === 0) {
            this.hooks.delete(hookName);
        }

        logger.info(`[HookManager] Unregistered "${handlerId}" from "${hookName}"`);
        return true;
    }

    execute<TContext extends HookContext>(
        hookName: string,
        context: TContext
    ): void {
        const handlers = this.hooks.get(hookName);
        if (!handlers || handlers.length === 0) {
            return;
        }

        logger.debug(`[HookManager] Executing hook "${hookName}" with ${handlers.length} handlers`);

        for (const handler of handlers) {
            try {
                handler.handler(context);
            } catch (error) {
                logger.error(`[HookManager] Error in handler "${handler.id}" for hook "${hookName}":`, String(error));
                // Continue executing other handlers even if one fails
            }
        }
    }

    async executeAsync<TContext extends HookContext>(
        hookName: string,
        context: TContext
    ): Promise<void> {
        const handlers = this.hooks.get(hookName);
        if (!handlers || handlers.length === 0) {
            return;
        }

        logger.debug(`[HookManager] Executing async hook "${hookName}" with ${handlers.length} handlers`);

        // Execute handlers sequentially (in priority order)
        for (const handler of handlers) {
            try {
                const result = handler.handler(context);
                if (result instanceof Promise) {
                    await result;
                }
            } catch (error) {
                logger.error(`[HookManager] Error in handler "${handler.id}" for hook "${hookName}":`, String(error));
                // Continue executing other handlers even if one fails
            }
        }
    }

    getHandlers<TContext extends HookContext>(
        hookName: string
    ): HookHandler<TContext>[] {
        return (this.hooks.get(hookName) || []) as HookHandler<TContext>[];
    }

    hasHandlers(hookName: string): boolean {
        const handlers = this.hooks.get(hookName);
        return handlers !== undefined && handlers.length > 0;
    }
}
