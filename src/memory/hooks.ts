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
import { MemoryStorage } from './storage';
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
 * Integrates Memory System with miniclaw through Hook Manager.
 * Uses Mode B: Hooks can modify context (add session history, search results, etc.)
 *
 * Phase 7 Week 4: Integration with Learning Loop
 * - Load relevant skills in afterDynamicContext
 * - Check learning triggers in afterExecute
 * - Compress context before LLM call if needed
 */
export class MemoryHooks {
  private skillLoader?: SkillLoader;
  private learningTriggers?: LearningTriggers;
  private knowledgeExtractor?: KnowledgeExtractor;
  private contextCompressor?: ContextCompressor;

  constructor(
    private memoryManager: MemoryManager,
    private sessionManager: SessionManager,
    learningStorage?: LearningStorage,
    llmProvider?: LLMProvider,
    memoryStorage?: MemoryStorage
  ) {
    // Initialize learning components if storage is provided
    if (learningStorage) {
      this.skillLoader = new SkillLoader(learningStorage);
      this.learningTriggers = new LearningTriggers();

      // KnowledgeExtractor requires LLMProvider and MemoryStorage
      if (llmProvider && memoryStorage) {
        this.knowledgeExtractor = new KnowledgeExtractor(llmProvider, memoryStorage);
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
   * Mode B: This hook MODIFIES context.context by appending session history
   */
  async onAfterStableContext(context: AfterStableContextContext): Promise<void> {
    if (!this.memoryManager || !context.userId) return;

    logger.debug(`[MemoryHooks] afterStableContext: Adding session history for user ${context.userId}`);

    // Get session history from SessionManager (in-memory buffer)
    const history = this.sessionManager.getSessionHistory(context.userId);

    if (history.length > 0) {
      // MODE B: Modify context by appending session history
      context.context += '\n## Recent Conversation\n\n';
      for (const msg of history.slice(-5)) {  // Last 5 messages
        context.context += `${msg.role}: ${msg.content}\n`;
      }

      logger.debug(`[MemoryHooks] Added ${history.length} messages to context`);
    }
  }

  /**
   * afterDynamicContext: Add search results and relevant skills
   *
   * Mode B: This hook MODIFIES context.context by appending search results and skills
   */
  async onAfterDynamicContext(context: AfterDynamicContextContext): Promise<void> {
    if (!this.memoryManager) return;

    logger.debug(`[MemoryHooks] afterDynamicContext: Searching for relevant conversations`);

    // FTS5 search for relevant past conversations
    const searchResults = this.memoryManager.fts5Search(context.task, 3);
    if (searchResults && searchResults.length > 0) {
      // MODE B: Modify context by appending search results
      context.context += '\n## Relevant Past Conversations\n\n';
      for (const result of searchResults.slice(0, 3)) {
        const snippet = result.snippet || result.content || JSON.stringify(result);
        context.context += `- ${snippet}\n`;
      }
      logger.debug(`[MemoryHooks] Added ${searchResults.length} search results to context`);
    }

    // Load relevant skills (Phase 7 Week 4)
    if (this.skillLoader && context.userId) {
      const skills = this.skillLoader.loadRelevantSkills(context.task, context.userId, 3);
      if (skills.length > 0) {
        const formattedSkills = this.skillLoader.formatSkillsForContext(skills);
        context.context += '\n' + formattedSkills;
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
    if (this.contextCompressor && context.estimatedTokens > 4000) {  // 80% of 5K limit
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
    if (this.learningTriggers && this.knowledgeExtractor && context.conversationId) {
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

        // Extract knowledge from this conversation
        try {
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
              logger.info(`[MemoryHooks] Extracted ${knowledge.type}: "${knowledge.title}" (confidence: ${knowledge.confidence})`);
            }

            // Knowledge is automatically saved by KnowledgeExtractor
          }
        } catch (error) {
          logger.error(`[MemoryHooks] Knowledge extraction failed: ${error instanceof Error ? error.message : String(error)}`);
        }
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
