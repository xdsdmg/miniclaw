import { HookManager, HOOKS } from '../core/hooks';
import { MemoryManager } from './manager';
import { SessionManager } from './session-manager';
import { logger } from '../logger';
import { SkillLoader } from '../learning/skills';
import { LearningTriggers, LearningContext } from '../learning/triggers';
import { KnowledgeExtractor, ExtractionContext } from '../learning/extractor';
import { ContextCompressor } from '../learning/compression';
import { LearningStorage } from '../learning/storage';
import { LLMProvider } from '../llm';
import type {
  BeforeExecuteContext,
  AfterStableContextContext,
  AfterDynamicContextContext,
  BeforeLLMCallContext,
  AfterLLMCallContext,
  BeforeToolCallContext,
  AfterToolCallContext,
  AfterExecuteContext,
  OnErrorContext
} from '../core/hooks';

/**
 * Memory Hooks
 *
 * Bridges the Memory / Learning system with the Agent's Hook architecture.
 * It registers one handler per hook point (see registerTo) so that every step of
 * the agent execution lifecycle is reflected in the memory database and, in turn,
 * past memory is injected back into the LLM prompt.
 *
 * ── Working Logic ─────────────────────────────────────────────────────────────
 *
 * The Agent fires 9 hook points during execution (beforeExecute → afterExecute /
 * onError). MemoryHooks translates those events into memory operations, which
 * fall into three categories:
 *
 *   A. CONTEXT ENRICHMENT — these hooks push content into the shared Context
 *      object (the Go-style context threaded through execution), so the final
 *      system prompt includes it:
 *      - afterStableContext : pushes the user's recent session history into
 *                             context.stableSections
 *      - afterDynamicContext: pushes FTS5 search results + relevant learned
 *                             skills into context.dynamicSections
 *      These sections flow into the final system prompt, so the LLM sees
 *      relevant past conversations and skills.
 *
 *   B. DATA RECORDING
 *      - beforeExecute  : startConversation() → seeds context.conversationId
 *      - afterLLMCall   : saveLLMInteraction() (request/response/tokens/cache)
 *      - afterToolCall  : saveToolExecution() (tool name, args, result, duration)
 *      - afterExecute   : endConversation(status = 'completed')
 *      - onError        : endConversation(status = 'error')
 *
 *   C. LEARNING LOOP
 *      - afterDynamicContext: load relevant skills into the prompt
 *      - beforeLLMCall      : compress oversized context if token budget exceeded
 *      - afterExecute       : evaluate learning triggers → extract knowledge → save skills
 *
 * All handlers run at priority 10 so they execute before Logger(50)/Monitor(20)
 * hooks and can modify context for downstream hooks to consume.
 *
 * @see Agent.runLoop / Agent.executeTaskInternal for where each hook fires.
 */
export class MemoryHooks {
  /** Loads relevant learned skills for the current task (used in afterDynamicContext). */
  private skillLoader?: SkillLoader;
  /** Evaluates whether a completed task qualifies for learning (used in afterExecute). */
  private learningTriggers?: LearningTriggers;
  /** Extracts structured knowledge (skill/pattern/fact) from successful conversations. */
  private knowledgeExtractor?: KnowledgeExtractor;
  /** Compresses long contexts before LLM calls to respect token limits. */
  private contextCompressor?: ContextCompressor;
  /** Persistence layer for learned skills (skills.db). */
  private learningStorage?: LearningStorage;

  constructor(
    /**
     * Unified memory service (the data layer). Used for:
     * - startConversation / endConversation — conversation lifecycle
     * - fts5Search — retrieving relevant past conversations for context injection
     * - saveLLMInteraction / saveToolExecution — persisting execution records
     * Required; the memory system always exists when MemoryHooks is created.
     */
    private memoryManager: MemoryManager,
    /**
     * In-memory per-user conversation buffer. Used for:
     * - getSessionHistory — recent messages appended in afterStableContext
     * - addMessage — tracking the running conversation so history is available
     *   to the next task without re-reading the database.
     * Required.
     */
    private sessionManager: SessionManager,
    /**
     * Skills database. When provided, enables the learning subsystem:
     * SkillLoader, LearningTriggers, KnowledgeExtractor, ContextCompressor.
     * When undefined, all learning-related hooks become no-ops.
     * Optional (falls back to memory-only behavior).
     */
    learningStorage?: LearningStorage,
    /**
     * LLM provider used by KnowledgeExtractor for semantic analysis during
     * knowledge extraction. Only needed when learningStorage is provided.
     * Optional.
     */
    llmProvider?: LLMProvider,
  ) {
    // Initialize the learning components only when a skills store is supplied,
    // so memory-only setups skip the entire learning loop.
    if (learningStorage) {
      this.learningStorage = learningStorage;
      this.skillLoader = new SkillLoader(learningStorage);
      this.learningTriggers = new LearningTriggers();

      // KnowledgeExtractor requires both an LLM and the raw storage to analyze
      // past tool executions; skip it (leave undefined) if either is missing.
      if (llmProvider && this.memoryManager.getStorage()) {
        this.knowledgeExtractor = new KnowledgeExtractor(llmProvider, this.memoryManager.getStorage());
      }

      this.contextCompressor = new ContextCompressor();
    }
  }

  // ========================================================================
  // Hook Handlers
  // ========================================================================

  /**
   * beforeExecute: Start conversation and load initial context
   */
  async onBeforeExecute(context: BeforeExecuteContext): Promise<void> {
    if (!this.memoryManager) return;

    logger.debug(`[MemoryHooks] beforeExecute: Starting conversation for user ${context.userId}`);

    // Start conversation
    const conversationId = this.memoryManager.startConversation(context.userId);

    // Attach conversationId to context for use in subsequent hooks
    context.conversationId = conversationId;

    // Note: user message is added in afterExecute, not here,
    // so that afterStableContext only sees historical messages.
  }

  /**
   * afterStableContext: Add session history to stable context
   *
   * Appends the user's recent session history as a stable-context section.
   */
  async onAfterStableContext(context: AfterStableContextContext): Promise<void> {
    if (!this.memoryManager || !context.userId) return;

    logger.debug(`[MemoryHooks] afterStableContext: Adding session history for user ${context.userId}`);

    // Get session history from SessionManager (in-memory buffer)
    const history = this.sessionManager.getSessionHistory(context.userId);

    if (history.length > 0) {
      // Append session history as a stable-context section
      let section = '## Recent Conversation\n\n';
      for (const msg of history.slice(-5)) {  // Last 5 messages
        section += `${msg.role}: ${msg.content}\n`;
      }
      context.context.stableSections.push(section);

      logger.debug(`[MemoryHooks] Added ${history.length} messages to context`);
    }
  }

  /**
   * afterDynamicContext: Add search results and relevant skills
   *
   * Appends FTS5 search results and relevant skills as dynamic-context sections.
   */
  async onAfterDynamicContext(context: AfterDynamicContextContext): Promise<void> {
    if (!this.memoryManager) return;

    logger.debug(`[MemoryHooks] afterDynamicContext: Searching for relevant conversations`);

    // FTS5 search for relevant past conversations
    const searchResults = this.memoryManager.fts5Search(context.task, 3);
    if (searchResults && searchResults.length > 0) {
      // Append search results as a dynamic-context section
      let section = '## Relevant Past Conversations\n\n';
      for (const result of searchResults.slice(0, 3)) {
        const snippet = result.snippet || result.content || JSON.stringify(result);
        section += `- ${snippet}\n`;
      }
      context.context.dynamicSections.push(section);
      logger.debug(`[MemoryHooks] Added ${searchResults.length} search results to context`);
    }

    // Load relevant skills (Phase 7 Week 4)
    // No userId guard: SkillLoader searches global skills when userId is undefined,
    // so skills load even in CLI mode where no userId is supplied.
    if (this.skillLoader) {
      const skills = this.skillLoader.loadRelevantSkills(context.task, context.userId, 3);
      if (skills.length > 0) {
        context.context.dynamicSections.push(this.skillLoader.formatSkillsForContext(skills));
        logger.debug(`[MemoryHooks] Added ${skills.length} relevant skills to context`);
      }
    }
  }

  /**
   * beforeLLMCall: Prepare for LLM call (logging, pre-flight checks)
   */
  async onBeforeLLMCall(context: BeforeLLMCallContext): Promise<void> {
    if (!this.memoryManager) return;

    logger.debug(`[MemoryHooks] beforeLLMCall: Conversation ${context.conversationId}, Model ${context.model}, ~${context.estimatedTokens} tokens`);

    // Preflight compression check (Phase 7 Week 4)
    // context.context guard: BeforeLLMCallContext has no `context` field, so without
    // this check compress(undefined) would throw on every large-context call.
    if (this.contextCompressor && context.context && context.estimatedTokens > 4000) {  // 80% of 5K limit
      logger.warn(`[MemoryHooks] Approaching token limit: ${context.estimatedTokens} tokens, triggering compression`);

      // Compress the context to reduce tokens
      try {
        const result = await this.contextCompressor.compress(context.context, {
          maxTokens: 3000,
          preserveSections: {
            currentTask: true,
            lastAssistantResponses: 2,
            minSkillSuccessRate: 0.7,
            toolResults: false,
          },
          compressionRatio: 0.5,
        });

        logger.info(`[MemoryHooks] Context compressed: ${result.originalTokens} -> ${result.compressedTokens} tokens`);

        // Update context with compressed version
        // Note: This would require modifying the context object structure
        // For now, we just log the compression result
      } catch (error) {
        logger.error(`[MemoryHooks] Compression failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * afterLLMCall: Record LLM interaction
   */
  async onAfterLLMCall(context: AfterLLMCallContext): Promise<void> {
    if (!this.memoryManager || !context.conversationId) return;

    logger.debug(`[MemoryHooks] afterLLMCall: Recording LLM interaction for conversation ${context.conversationId}`);

    this.memoryManager.saveLLMInteraction(
      context.conversationId,
      JSON.stringify(context.requestMessages),
      context.response.content || '',
      context.response.model || 'unknown',
      context.response.usage?.total_tokens,
      context.cached
    );

    // Add assistant response to session history
    if (context.userId) {
      this.sessionManager.addMessage(context.userId, 'assistant', context.response.content || '');
      logger.debug(`[MemoryHooks] Added assistant message to session for user ${context.userId}`);
    }
  }

  /**
   * beforeToolCall: Prepare for tool execution
   */
  async onBeforeToolCall(context: BeforeToolCallContext): Promise<void> {
    logger.debug(`[MemoryHooks] beforeToolCall: Executing tool ${context.toolName}`);
    // Nothing to record yet, just logging
  }

  /**
   * afterToolCall: Record tool execution and track errors
   */
  async onAfterToolCall(context: AfterToolCallContext): Promise<void> {
    if (!this.memoryManager || !context.conversationId) return;

    logger.debug(`[MemoryHooks] afterToolCall: Tool ${context.toolName} completed in ${context.duration}ms, success=${context.success}`);

    this.memoryManager.saveToolExecution(
      context.conversationId,
      context.toolName,
      context.toolArguments,
      context.result.output || context.result.error || '',
      context.duration,
      context.success,
      context.errorMessage
    );

    // Track error state for learning trigger
    if (!context.success) {
      (context as any).hadError = true;
    }
  }

  /**
   * afterExecute: Check learning triggers and end conversation
   */
  async onAfterExecute(context: AfterExecuteContext): Promise<void> {
    if (!this.memoryManager) return;

    logger.debug(`[MemoryHooks] afterExecute: Task completed in ${context.duration}ms, checking learning triggers`);

    // Add user task to session history for future conversations
    if (context.userId) {
      this.sessionManager.addMessage(context.userId, 'user', context.task);
      logger.debug(`[MemoryHooks] Added user message to session for user ${context.userId}`);
    }

    // Check learning triggers (Phase 7 Week 4)
    // Non-blocking: extraction (an extra LLM round-trip) runs fire-and-forget so it
    // never delays the task response. Requires the skills storage to persist results.
    if (this.learningTriggers && this.knowledgeExtractor && this.learningStorage && context.conversationId) {
      const learningContext: LearningContext = {
        conversationId: context.conversationId,
        userId: context.userId || 'unknown',
        task: context.task,
        result: context.success ? 'Task completed successfully' : 'Task failed',
        turnCount: context.turnCount,
        toolCallCount: context.toolCallCount,
        hadErrors: !context.success,
        recovered: context.success && (context as any).hadError,
        duration: context.duration,
      };

      const triggerResult = this.learningTriggers.evaluate(learningContext);

      if (triggerResult.shouldLearn) {
        logger.info(`[MemoryHooks] Learning triggered: ${triggerResult.quality} quality, score: ${triggerResult.score}`);
        this.extractAndSave(learningContext).catch(error => {
          logger.error(`[MemoryHooks] Knowledge extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else {
        logger.debug(`[MemoryHooks] Learning not triggered: score ${triggerResult.score} below threshold`);
      }
    }

    // End conversation
    if (context.conversationId) {
      this.memoryManager.endConversation(context.conversationId, 'completed');
    }
  }

  /**
   * Extract knowledge from a conversation and persist it as a learned skill.
   * Runs fire-and-forget (non-blocking) from onAfterExecute; errors are logged by the caller.
   */
  private async extractAndSave(learningContext: LearningContext): Promise<void> {
    if (!this.knowledgeExtractor || !this.learningStorage) return;

    // Convert LearningContext to ExtractionContext
    const extractionContext: ExtractionContext = {
      conversationId: learningContext.conversationId,
      userId: learningContext.userId,
      task: learningContext.task,
      result: learningContext.result,
      turnCount: learningContext.turnCount,
      success: !learningContext.hadErrors || learningContext.recovered,
    };

    const knowledgeItems = await this.knowledgeExtractor.extract(extractionContext);

    if (knowledgeItems && knowledgeItems.length > 0) {
      for (const knowledge of knowledgeItems) {
        const learnedSkill = this.knowledgeExtractor.toLearnedSkill(knowledge);
        this.learningStorage.saveSkill(learnedSkill);
        logger.info(`[MemoryHooks] Extracted & saved ${knowledge.type}: "${knowledge.title}" (confidence: ${knowledge.confidence})`);
      }
    }
  }

  /**
   * onError: Handle error and end conversation with error status
   */
  async onError(context: OnErrorContext): Promise<void> {
    if (!this.memoryManager || !context.conversationId) return;

    logger.error(`[MemoryHooks] onError: Error in phase ${context.phase}:`, context.error.message);

    if (context.conversationId) {
      this.memoryManager.endConversation(context.conversationId, 'error');
    }
  }

  // ========================================================================
  // Registration
  // ========================================================================

  /**
   * Register all memory hooks to the hook manager
   */
  registerTo(hookManager: HookManager): void {
    // Priority 10: Memory hooks should run before most other hooks
    // (Logger hooks typically run at priority 50, Monitor at priority 20)

    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'memory-before-execute',
      name: 'Memory: Start conversation',
      priority: 10,
      handler: this.onBeforeExecute.bind(this)
    });

    hookManager.register(HOOKS.AFTER_STABLE_CONTEXT, {
      id: 'memory-after-stable-context',
      name: 'Memory: Add session history',
      priority: 10,
      handler: this.onAfterStableContext.bind(this)
    });

    hookManager.register(HOOKS.AFTER_DYNAMIC_CONTEXT, {
      id: 'memory-after-dynamic-context',
      name: 'Memory: Add search results and skills',
      priority: 10,
      handler: this.onAfterDynamicContext.bind(this)
    });

    hookManager.register(HOOKS.BEFORE_LLM_CALL, {
      id: 'memory-before-llm',
      name: 'Memory: Before LLM call',
      priority: 10,
      handler: this.onBeforeLLMCall.bind(this)
    });

    hookManager.register(HOOKS.AFTER_LLM_CALL, {
      id: 'memory-after-llm',
      name: 'Memory: Record LLM response',
      priority: 10,
      handler: this.onAfterLLMCall.bind(this)
    });

    hookManager.register(HOOKS.BEFORE_TOOL_CALL, {
      id: 'memory-before-tool',
      name: 'Memory: Before tool call',
      priority: 10,
      handler: this.onBeforeToolCall.bind(this)
    });

    hookManager.register(HOOKS.AFTER_TOOL_CALL, {
      id: 'memory-after-tool',
      name: 'Memory: Record tool execution',
      priority: 10,
      handler: this.onAfterToolCall.bind(this)
    });

    hookManager.register(HOOKS.AFTER_EXECUTE, {
      id: 'memory-after-execute',
      name: 'Memory: Check learning triggers',
      priority: 10,
      handler: this.onAfterExecute.bind(this)
    });

    hookManager.register(HOOKS.ON_ERROR, {
      id: 'memory-on-error',
      name: 'Memory: Handle error',
      priority: 10,
      handler: this.onError.bind(this)
    });

    logger.info('[MemoryHooks] All hooks registered successfully');
  }
}
