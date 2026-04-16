/**
 * Miniclaw Agent Core
 * 
 * Core AI Agent implementation, responsible for:
 * 1. Interacting with LLM to generate responses
 * 2. Parsing tool call requests from LLM
 * 3. Executing tools and collecting results
 * 4. Iterating until task completion
 * 
 * Execution Flow:
 *   1. Send task and available tools to LLM
 *   2. If LLM returns tool calls, execute corresponding tools
 *   3. Return tool results to LLM for continued processing
 *   4. Repeat until LLM returns final result or max iterations reached
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

/**
 * Agent Configuration Interface
 * Defines all parameters needed for connecting to LLM
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
 * Agent Class
 * Core AI Agent implementation, responsible for interacting with LLM and executing tool calls
 * 
 * Usage:
 *   const agent = new Agent({ provider: 'openai', apiKey: '...' });
 *   await agent.execute("Write me a hello world program");
 * 
 * Or with progress callback:
 *   await agent.runLoop(task, (event) => console.log(event));
 */
export class Agent {
  private llm: LLMProvider;
  private toolExecutor: ToolExecutor;
  private systemPrompt: string;
  private featurePrompts: string[];

  /**
   * Constructor
   * @param config Agent configuration including LLM provider and authentication info
   */
  constructor(private config: AgentConfig) {
    this.llm = new LLMProvider(config);
    this.toolExecutor = new ToolExecutor();
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.featurePrompts = config.featurePrompts || [];
  }

  /**
   * Run Agent Loop
   * Core execution loop: interact with LLM and handle tool calls until task completion or max iterations
   *
   * Loop Logic:
   *   1. Build context (system prompt + history + current task) via ContextBuilder
   *   2. Send context and available tools to LLM
   *   3. If LLM returns tool calls, execute tools and append results to history
   *   4. If no tool calls, return LLM's response content as final result
   *   5. Repeat steps 2-4 until max iterations reached
   *
   * @param input       Task description
   * @param onProgress Progress callback function for real-time execution progress
   * @returns Task execution result (LLM's final response content)
   */
  public async runLoop(
    input: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    // Build initial messages: system prompt + user task
    const toolDescs = extractToolDescriptions(tools);
    const initialMessages = new ContextBuilder({
      systemPrompt: this.systemPrompt,
      featurePrompts: this.featurePrompts,
      toolDescriptions: toolDescs,
      userMessage: input,
    }).build();

    // Split into prefix (system) and history (user message)
    // Prefix is built once and reused; history accumulates across iterations
    const prefixMessages = initialMessages.slice(0, -1);
    const history: ChatMessage[] = [initialMessages[initialMessages.length - 1]];

    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      onProgress?.({ stage: 'thinking', message: `Iteration ${iteration + 1}: Thinking...` });

      const allMessages = [...prefixMessages, ...history];

      logger.debug(`LLM Call, Iteration ${iteration + 1}`, {
        messages: allMessages.map(m => ({ role: m.role, content: m.content })),
      });

      const response = await this.llm.generateResponse(allMessages, tools);

      logger.debug(`LLM Response, Iteration ${iteration + 1}`, {
        content: response.content || '(empty)',
        toolCalls: response.toolCalls?.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments,
        })),
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        // Record assistant message with tool calls
        history.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });

        // Execute tools and record results as proper tool messages
        for (const toolCall of response.toolCalls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);

          onProgress?.({
            stage: 'executing',
            message: `Executing ${toolName}`,
            tool: toolName,
            args,
          });

          try {
            const result = await this.toolExecutor.execute(toolName, args);
            logger.debug(`Tool ${toolName} result`, result);
            onProgress?.({
              stage: 'tool_result',
              message: `Tool ${toolName} completed`,
              tool: toolName,
              toolResult: result,
            });

            history.push({
              role: 'tool',
              content: result,
              tool_call_id: toolCall.id,
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            onProgress?.({
              stage: 'tool_result',
              message: `Tool ${toolName} failed: ${errorMsg}`,
              tool: toolName,
              toolResult: `Error: ${errorMsg}`,
            });

            history.push({
              role: 'tool',
              content: `Error: ${errorMsg}`,
              tool_call_id: toolCall.id,
            });
          }
        }
      } else {
        // Final response — no tool calls
        history.push({ role: 'assistant', content: response.content });
        onProgress?.({ stage: 'completed', message: 'Task completed' });
        return response.content;
      }

      iteration++;
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
   * @param task Task description
   */
  async execute(task: string): Promise<void> {
    logger.info(`Executing task: ${task}`);

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

    const result = await this.runLoop(task, onProgress);
    logger.info(`Task completed, result: ${result}`);
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
   * This method wraps the runLoop method to execute tasks and returns structured
   * execution results (including success status, result content, error info and execution time)
   * 
   * @param task        Task description
   * @param taskConfig  Optional task-specific configuration override
   * @param onProgress  Progress callback (optional), used for streaming task execution progress
   * @returns Execution result containing success, result/error and executionTime
   */
  async executeTask(
    task: string,
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

      const result = await this.runLoop(task, onProgress);

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
