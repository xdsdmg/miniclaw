/**
 * Miniclaw Agent Core
 *
 * Core AI Agent implementation with Hook Architecture support.
 * Responsible for:
 * 1. Interacting with LLM to generate responses
 * 2. Parsing tool call requests from LLM
 * 3. Executing tools and collecting results
 * 4. Iterating until task completion
 * 5. Executing hooks at defined points for plugin integration
 *
 * Execution Flow:
 *   1. Send task and available tools to LLM
 *   2. If LLM returns tool calls, execute corresponding tools
 *   3. Return tool results to LLM for continued processing
 *   4. Repeat until LLM returns final result or max iterations reached
 *   5. Execute hooks throughout the flow for plugin integration
 */

import { LLMProvider } from './llm';
import { ToolExecutor } from './tools';
import { tools } from './tools-schema';
import {
  ChatMessage,
  ContextBuilder,
  extractToolDescriptions,
  DEFAULT_SYSTEM_PROMPT,
} from './prompt';
import { logger } from './logger';
import { HookManager, HookManagerImpl, HOOKS } from './core/hooks';
import { MemoryHooks } from './memory/hooks';
import { MemoryManager } from './memory/manager';
import { SessionManager } from './memory/session-manager';

/**
 * Agent Configuration Interface
 * Defines all parameters needed for connecting to LLM and configuring hooks
 */
export interface AgentConfig {
  /** LLM provider name (deepseek, kimi, qwen, openai) */
  provider: string;
  /** LLM API key */
  apiKey?: string;
  /** OpenAI-compatible API base URL */
  baseURL?: string;
  /** System prompt defining the agent's identity and behavior */
  systemPrompt?: string;
  /** Feature-specific instructions */
  featurePrompts?: string[];

  // Memory Configuration (optional, for backward compatibility)
  /** Enable memory system hooks (default: true) */
  enableMemory?: boolean;
  /** Memory database path */
  memoryDbPath?: string;
  /** Memories directory path */
  memoriesDir?: string;
  /** Skills directory path */
  skillsDir?: string;
  /** Prompt memory character limit */
  promptMemoryCharLimit?: number;

  // Hook Configuration
  /** Optional: Use existing HookManager */
  hookManager?: HookManager;
  /** Enable memory hooks (default: true if enableMemory is true) */
  enableMemoryHooks?: boolean;
}

/**
 * Task Execution Result Interface
 */
export interface ExecuteResult {
  /** Whether execution was successful */
  success: boolean;
  /** Task execution result content */
  result?: string;
  /** Error message (when execution fails) */
  error?: string;
  /** Execution time (milliseconds) */
  executionTime: number;
}

/**
 * Task Progress Event Types
 * - thinking: LLM is analyzing task
 * - executing: Tool is being executed
 * - tool_result: Tool execution completed
 * - completed: Task completed
 */
export type ProgressStage = 'thinking' | 'executing' | 'tool_result' | 'completed';

/**
 * Progress Event Interface
 * Used for streaming task execution progress
 */
export interface ProgressEvent {
  /** Current progress stage */
  stage: ProgressStage;
  /** Stage description message */
  message?: string;
  /** Executed tool name */
  tool?: string;
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** Tool execution result */
  toolResult?: string;
}

/**
 * Progress Callback Type
 * Used to receive progress updates during task execution
 */
type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Maximum iterations
 * Prevents infinite loops, controls the number of interaction rounds between agent and LLM
 */
const MAX_ITERATIONS = 10;

/**
 * Execution Context
 * Tracks state during task execution
 */
interface ExecutionContext {
  /** Current iteration count */
  turnCount: number;
  /** Total tool calls made */
  toolCallCount: number;
  /** Current conversation ID (set by MemoryHooks) */
  conversationId?: string;
}

/**
 * Agent Class
 * Core AI Agent implementation with Hook Architecture support.
 * Executes hooks at defined points for plugin integration (Memory, Logger, Monitor, etc.)
 *
 * Usage:
 *   // Simple usage (backward compatible)
 *   const agent = new Agent({ provider: 'openai', apiKey: '...' });
 *   await agent.execute("Write me a hello world program");
 *
 *   // With custom hooks
 *   const hookManager = new HookManagerImpl();
 *   // Register custom hooks...
 *   const agent = new Agent({ provider: 'openai', hookManager });
 *   await agent.runLoop(task, onProgress);
 *
 *   // With memory system
 *   const agent = new Agent({
 *     provider: 'openai',
 *     enableMemory: true,
 *     memoryDbPath: './data/miniclaw.db'
 *   });
 */
export class Agent {
  private llm: LLMProvider;
  private toolExecutor: ToolExecutor;
  private hookManager: HookManager;
  private config: AgentConfig;
  private systemPrompt: string;
  private featurePrompts: string[];
  // Enhanced contexts from hooks (stored temporarily for single task execution)
  private enhancedStableContext?: string;
  private enhancedDynamicContext?: string;

  /**
   * Constructor
   * @param config Agent configuration including LLM provider, authentication info, and hook settings
   */
  constructor(config: AgentConfig) {
    this.config = config;
    this.llm = new LLMProvider(config);
    this.toolExecutor = new ToolExecutor();
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.featurePrompts = config.featurePrompts || [];

    // Initialize or use provided HookManager
    this.hookManager = config.hookManager || new HookManagerImpl();

    // Initialize Memory Hooks if enabled
    if (config.enableMemory !== false && config.enableMemoryHooks !== false) {
      this.initializeMemoryHooks();
    }

    logger.info('[Agent] Initialized with hook-based architecture');
  }

  /**
   * Ensure directories exist for memory system
   * Creates required directories if they don't exist
   */
  private ensureDirectoriesExist(dbPath: string, memoriesDir: string, skillsDir: string): void {
    const fs = require('fs');
    const path = require('path');

    // Create database directory
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`[Agent] Created directory: ${dbDir}`);
    }

    // Create memories directory
    const resolvedMemoriesDir = path.resolve(memoriesDir);
    if (!fs.existsSync(resolvedMemoriesDir)) {
      fs.mkdirSync(resolvedMemoriesDir, { recursive: true });
      logger.info(`[Agent] Created directory: ${resolvedMemoriesDir}`);
    }

    // Create skills directory
    const resolvedSkillsDir = path.resolve(skillsDir);
    if (!fs.existsSync(resolvedSkillsDir)) {
      fs.mkdirSync(resolvedSkillsDir, { recursive: true });
      logger.info(`[Agent] Created directory: ${resolvedSkillsDir}`);
    }
  }

  /**
   * Initialize Memory Hooks
   * Sets up MemoryManager, SessionManager, and MemoryHooks
   */
  private initializeMemoryHooks(): void {
    try {
      const dbPath = this.config.memoryDbPath || './data/miniclaw.db';
      const memoriesDir = this.config.memoriesDir || './.miniclaw/memories';
      const skillsDir = this.config.skillsDir || './.miniclaw/skills';

      // Ensure required directories exist
      this.ensureDirectoriesExist(dbPath, memoriesDir, skillsDir);

      // Initialize MemoryManager (llmProvider is optional for MemoryManager)
      const memoryManager = new MemoryManager({
        dbPath,
        memoriesDir,
        skillsDir,
        promptMemoryCharLimit: this.config.promptMemoryCharLimit || 3575
      });

      // Initialize SessionManager
      const sessionManager = new SessionManager(memoryManager);

      // Create and register MemoryHooks
      const memoryHooks = new MemoryHooks(memoryManager, sessionManager);
      memoryHooks.registerTo(this.hookManager);

      logger.info('[Agent] Memory hooks registered');
    } catch (error) {
      logger.warn('[Agent] Failed to initialize memory hooks:', error as Error);
      // Don't fail the entire agent if memory hooks fail
    }
  }

  /**
   * Get the HookManager instance
   * Used for external hook registration
   */
  getHookManager(): HookManager {
    return this.hookManager;
  }

  /**
   * Estimate token count for messages
   * Rough estimation: ~4 characters per token
   */
  private estimateTokens(messages: ChatMessage[]): number {
    const chars = messages.map(m => m.content || '').join('').length;
    return Math.ceil(chars / 4);
  }

  /**
   * Build stable context
   * Base system prompt that Memory hooks can enhance with:
   * - MEMORY.md and USER.md (frozen snapshot)
   * - Skill index (names only)
   * - Session history (if userId provided)
   */
  private async buildStableContext(_task: string, _userId?: string): Promise<string> {
    // Base system prompt
    const toolDescs = extractToolDescriptions(tools);
    const contextBuilder = new ContextBuilder({
      systemPrompt: this.systemPrompt,
      featurePrompts: this.featurePrompts,
      toolDescriptions: toolDescs,
      userMessage: '', // Will be added separately
    });

    // Build base context (without user message)
    const baseMessages = contextBuilder.build();
    const systemMessage = baseMessages[0];
    return systemMessage.content;
  }

  /**
   * Build dynamic context
   * Memory hooks will add:
   * - FTS5 search results
   * - Relevant skills
   */
  private async buildDynamicContext(_task: string, _userId?: string): Promise<string> {
    // Memory hooks will add search results and relevant skills
    return '';
  }

  /**
   * Run Agent Loop (with Hook support)
   * Core execution loop with hook execution at key points
   *
   * Loop Logic:
   *   1. Build context (system prompt + history + current task)
   *   2. Execute beforeLLMCall hook
   *   3. Send context and available tools to LLM
   *   4. Execute afterLLMCall hook
   *   5. If LLM returns tool calls, execute tools and append results to history
   *   6. If no tool calls, return LLM's response content as final result
   *   7. Repeat steps 2-6 until max iterations reached
   *
   * @param input       Task description
   * @param onProgress Progress callback function for real-time execution progress
   * @returns Task execution result (LLM's final response content)
   */
  public async runLoop(
    input: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const executionContext: ExecutionContext = {
      turnCount: 0,
      toolCallCount: 0,
      conversationId: undefined
    };

    // Use enhanced contexts if available (from hooks), otherwise fall back to default
    const systemPrompt = this.enhancedStableContext || this.systemPrompt;
    const dynamicContext = this.enhancedDynamicContext || '';

    // Combine system prompt with dynamic context
    const fullSystemPrompt = dynamicContext
      ? `${systemPrompt}\n\n${dynamicContext}`
      : systemPrompt;

    // Build initial messages: system prompt + user task
    // Note: fullSystemPrompt already contains tool descriptions and feature prompts
    //       from buildStableContext, so we don't pass them again to avoid duplication.
    const initialMessages = new ContextBuilder({
      systemPrompt: fullSystemPrompt,
      featurePrompts: [],
      toolDescriptions: [],
      userMessage: input,
    }).build();

    // Split into prefix (system) and history (user message)
    // Prefix is built once and reused; history accumulates across iterations
    const prefixMessages = initialMessages.slice(0, -1);
    const history: ChatMessage[] = [initialMessages[initialMessages.length - 1]];

    // Clear enhanced contexts after use (they're single-use)
    this.enhancedStableContext = undefined;
    this.enhancedDynamicContext = undefined;

    while (executionContext.turnCount < MAX_ITERATIONS) {
      executionContext.turnCount++;
      onProgress?.({ stage: 'thinking', message: `Iteration ${executionContext.turnCount}: Thinking...` });

      const allMessages = [...prefixMessages, ...history];

      // ===== Hook: beforeLLMCall =====
      await this.hookManager.executeAsync(HOOKS.BEFORE_LLM_CALL, {
        taskId: `task-${Date.now()}`,
        conversationId: executionContext.conversationId,
        messages: allMessages,
        model: this.config.provider,
        estimatedTokens: this.estimateTokens(allMessages)
      }).catch(err => {
        logger.warn('[Agent] beforeLLMCall hook error:', err as Error);
      });

      logger.debug(
        `LLM Call, Iteration ${executionContext.turnCount} (${allMessages.length} messages)\n` +
        allMessages.map(m =>
          `role: ${m.role}` +
          `\ncontent: ${m.content || ''}` +
          (m.tool_calls ? `\ntool_calls: ${JSON.stringify(m.tool_calls)}` : '') +
          (m.tool_call_id ? `\ntool_call_id: ${m.tool_call_id}` : '')
        ).join('\n\n')
      );

      // ===== Call LLM =====
      const llmStart = Date.now();
      const response = await this.llm.generateResponse(allMessages, tools);
      const llmDuration = Date.now() - llmStart;

      logger.debug(`LLM Response, Iteration ${executionContext.turnCount}`, {
        content: response.content || '(empty)',
        toolCalls: response.toolCalls?.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
      });

      // ===== Hook: afterLLMCall =====
      await this.hookManager.executeAsync(HOOKS.AFTER_LLM_CALL, {
        taskId: `task-${Date.now()}`,
        conversationId: executionContext.conversationId,
        requestMessages: allMessages,
        response: {
          content: response.content || '',
          model: this.config.provider,
          usage: { total_tokens: this.estimateTokens(allMessages) }
        },
        duration: llmDuration,
        cached: false,
        success: true
      }).catch(err => {
        logger.warn('[Agent] XXX hook error:', err as Error);
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Record assistant message with tool calls
        logger.debug(`toolCalls: ${JSON.stringify(response.toolCalls)}`)
        history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });

        // Execute tools and record results as proper tool messages
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          const toolStartTime = Date.now();

          // ===== Hook: beforeToolCall =====
          await this.hookManager.executeAsync(HOOKS.BEFORE_TOOL_CALL, {
            taskId: `task-${Date.now()}`,
            conversationId: executionContext.conversationId,
            toolName,
            toolArguments: args,
            timestamp: toolStartTime
          }).catch(err => {
            logger.warn('[Agent] XXX hook error:', err as Error);
          });

          onProgress?.({
            stage: 'executing',
            message: `Executing ${toolName}`,
            tool: toolName,
            args,
          });

          let result: string;
          let success = true;

          try {
            result = await this.toolExecutor.execute(toolName, args);
            logger.debug(`Tool ${toolName} result`, result);
            onProgress?.({
              stage: 'tool_result',
              message: `Tool ${toolName} completed`,
              tool: toolName,
              toolResult: result,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result = `Error: ${errorMsg}`;
            success = false;
            onProgress?.({
              stage: 'tool_result',
              message: `Tool ${toolName} failed: ${errorMsg}`,
              tool: toolName,
              toolResult: result,
            });
          }

          const toolDuration = Date.now() - toolStartTime;
          executionContext.toolCallCount++;

          // ===== Hook: afterToolCall =====
          await this.hookManager.executeAsync(HOOKS.AFTER_TOOL_CALL, {
            taskId: `task-${Date.now()}`,
            conversationId: executionContext.conversationId,
            toolName,
            toolArguments: args,
            result: { output: result, error: success ? '' : result },
            duration: toolDuration,
            success,
            errorMessage: success ? '' : result
          }).catch(err => {
            logger.warn('[Agent] XXX hook error:', err as Error);
          });

          history.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
        }
      } else {
        // Final response — no tool calls
        history.push({ role: 'assistant', content: response.content });
        onProgress?.({ stage: 'completed', message: 'Task completed' });
        return response.content;
      }
    }

    logger.warn('Max iterations reached');
    const maxReachedMsg = "Max iterations reached. Stopping execution.";
    onProgress?.({ stage: 'completed', message: maxReachedMsg });
    return maxReachedMsg;
  }

  /**
   * Execute Task (CLI Entry)
   * Uses console.log to output execution progress, suitable for CLI interaction scenarios
   *
   * @param task  Task description
   * @param userId Optional user ID for memory system
   */
  async execute(task: string, userId?: string): Promise<void> {
    const onProgress = (event: ProgressEvent) => {
      switch (event.stage) {
        case 'thinking':
          logger.info(`Thinking: ${event.message}`);
          break;
        case 'executing':
          logger.info(`Executing ${event.tool}: ${JSON.stringify(event.args)}\n`);
          break;
        case 'tool_result':
          logger.info(`Tool Result:\n${event.toolResult}\n`);
          break;
        case 'completed':
          break;
      }
    };

    const result = await this.executeTaskInternal(task, userId, onProgress);
    logger.info(`Task completed, result: ${result}`);
  }

  /**
   * Execute Task Internal (Shared Logic)
   * Core task execution logic shared by execute() and executeTask()
   *
   * @param task        Task description
   * @param userId      Optional user ID for memory system
   * @param onProgress  Progress callback (optional)
   * @returns Task execution result (LLM's final response content)
   */
  private async executeTaskInternal(
    task: string,
    userId?: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    const taskId = `task-${Date.now()}`;
    const startTime = Date.now();

    logger.info(`Executing task:\n${task}`);

    try {
      // ===== Hook: beforeExecute =====
      await this.hookManager.executeAsync(HOOKS.BEFORE_EXECUTE, {
        taskId,
        userId,
        task,
        timestamp: startTime
      }).catch(err => {
        logger.warn('[Agent] beforeExecute hook error:', err as Error);
      });

      // ===== Build Stable Context =====
      const stableContext = await this.buildStableContext(task, userId);

      // ===== Hook: afterStableContext =====
      const stableContextState = {
        taskId,
        userId,
        task,
        context: stableContext,
        contextType: 'stable' as const,
        tokenCount: this.estimateTokens([{ role: 'system', content: stableContext }]),
        cached: true
      };
      await this.hookManager.executeAsync(HOOKS.AFTER_STABLE_CONTEXT, stableContextState).catch(err => {
        logger.warn('[Agent] afterStableContext hook error:', err as Error);
      });

      // Store enhanced stable context for runLoop to use
      this.enhancedStableContext = stableContextState.context;

      // ===== Build Dynamic Context =====
      const dynamicContext = await this.buildDynamicContext(task, userId);

      // ===== Hook: afterDynamicContext =====
      const dynamicContextState = {
        taskId,
        userId,
        task,
        context: dynamicContext,
        contextType: 'dynamic' as const,
        tokenCount: this.estimateTokens([{ role: 'system', content: dynamicContext }])
      };
      await this.hookManager.executeAsync(HOOKS.AFTER_DYNAMIC_CONTEXT, dynamicContextState).catch(err => {
        logger.warn('[Agent] afterDynamicContext hook error:', err as Error);
      });

      // Store enhanced dynamic context for runLoop to use
      this.enhancedDynamicContext = dynamicContextState.context;

      // Execute main loop
      const result = await this.runLoop(task, onProgress);

      // ===== Hook: afterExecute =====
      await this.hookManager.executeAsync(HOOKS.AFTER_EXECUTE, {
        taskId,
        userId,
        conversationId: undefined, // Will be set by MemoryHooks if they ran
        task,
        result,
        duration: Date.now() - startTime,
        success: true,
        turnCount: 0, // Simplified
        toolCallCount: 0 // Simplified
      }).catch(err => {
        logger.warn('[Agent] afterExecute hook error:', err as Error);
      });

      return result;
    } catch (error) {
      // ===== Hook: onError =====
      await this.hookManager.executeAsync(HOOKS.ON_ERROR, {
        taskId,
        conversationId: undefined,
        error: error as Error,
        phase: 'unknown'
      }).catch(err => {
        logger.warn('[Agent] onError hook error:', err as Error);
      });
      throw error;
    }
  }

  /**
   * Update Agent Configuration
   * Updates the agent configuration and recreates the LLM provider if needed
   *
   * @param newConfig Partial configuration to update
   */
  updateConfig(newConfig: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.llm = new LLMProvider(this.config);
  }

  /**
   * Execute Task (Server Entry)
   * Provides stateless task execution, suitable for HTTP server scenarios
   *
   * This method wraps the execute method to provide structured execution results
   *
   * @param task        Task description
   * @param userId      Optional user ID for memory system
   * @param taskConfig  Optional task-specific configuration override
   * @param onProgress  Progress callback (optional), used for streaming task execution progress
   * @returns Execution result containing success, result/error and executionTime
   */
  async executeTask(
    task: string,
    userId?: string,
    taskConfig?: Partial<AgentConfig>,
    onProgress?: ProgressCallback
  ): Promise<ExecuteResult> {
    const startTime = Date.now();

    try {
      // Update configuration if task-specific config is provided
      if (taskConfig) {
        this.updateConfig(taskConfig);
      }

      onProgress?.({ stage: 'thinking', message: `Analyzing task: ${task}` });

      // Call the shared execution logic
      const result = await this.executeTaskInternal(task, userId, onProgress);

      return {
        success: true,
        result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : '';
      return {
        success: false,
        error: `Error: ${errorMsg}${stack ? '\nStack: ' + stack : ''}`,
        executionTime: Date.now() - startTime,
      };
    }
  }
}
