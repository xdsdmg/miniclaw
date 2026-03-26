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

  /**
   * Constructor
   * @param config Agent configuration including LLM provider and authentication info
   */
  constructor(private config: AgentConfig) {
    this.llm = new LLMProvider(config);
    this.toolExecutor = new ToolExecutor();
  }

  /**
   * Handle Tool Calls
   * Parses tool call requests from LLM, executes corresponding tool functions,
   * and returns updated task description
   * 
   * Execution Steps:
   *   1. Iterate through all tool calls
   *   2. Parse tool name and arguments
   *   3. Trigger executing progress event
   *   4. Execute tool and get result
   *   5. Trigger tool_result progress event
   *   6. Append tool result to task description, return to LLM for continued processing
   * 
   * @param toolCalls    LLM returned tool call request list
   * @param originalTask  Original task description
   * @param onProgress    Progress callback function
   * @returns Updated task description containing tool execution results
   */
  private async handleToolCalls(
    toolCalls: Array<{ function: { name: string; arguments: string } }>,
    originalTask: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    let currentTask = originalTask;

    for (const toolCall of toolCalls) {
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
        onProgress?.({
          stage: 'tool_result',
          message: `Tool ${toolName} completed`,
          tool: toolName,
          toolResult: result,
        });

        currentTask = `Tool ${toolName} returned:\n${result}\n\nContinue with the original task: ${originalTask}`;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        onProgress?.({
          stage: 'tool_result',
          message: `Tool ${toolName} failed: ${errorMsg}`,
          tool: toolName,
          toolResult: `Error: ${errorMsg}`,
        });
        currentTask = `Error executing tool ${toolName}: ${error}. Please adjust your approach for: ${originalTask}`;
      }
    }

    return currentTask;
  }

  /**
   * Run Agent Loop
   * Core execution loop: interact with LLM and handle tool calls until task completion or max iterations
   * 
   * Loop Logic:
   *   1. Send current task and available tools to LLM
   *   2. LLM returns response (final result or tool calls)
   *   3. If tool calls exist, execute tools and update task description
   *   4. If no tool calls, return LLM's response content as final result
   *   5. Repeat steps 1-4 until max iterations reached
   * 
   * @param task       Task description
   * @param onProgress Progress callback function for real-time execution progress
   * @returns Task execution result (LLM's final response content)
   */
  public async runLoop(
    task: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    let currentTask = task;
    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      onProgress?.({ stage: 'thinking', message: `Iteration ${iteration + 1}: Thinking...` });

      const response = await this.llm.generateResponse(currentTask, tools);

      console.log(`\n=== LLM Response (Iteration ${iteration + 1}) ===`);
      console.log(`task: ${currentTask}`);
      console.log(`Content: ${response.content || '(empty)'}`);
      if (response.toolCalls && response.toolCalls.length > 0) {
        console.log(`Tool Calls: ${JSON.stringify(response.toolCalls.map(tc => ({
          name: tc.function.name,
          arguments: tc.function.arguments
        })))}`);
      }
      console.log('==========================================\n');

      if (response.toolCalls) {
        currentTask = await this.handleToolCalls(response.toolCalls, task, onProgress);
      } else {
        onProgress?.({ stage: 'completed', message: 'Task completed' });
        return response.content;
      }

      iteration++;
    }

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
    console.log(`Executing task: ${task}\n`);

    const onProgress = (event: ProgressEvent) => {
      switch (event.stage) {
        case 'thinking':
          console.log(`Thinking: ${event.message}\n`);
          break;
        case 'executing':
          console.log(`Executing ${event.tool}: ${JSON.stringify(event.args)}\n`);
          break;
        case 'tool_result':
          console.log(`Tool Result:\n${event.toolResult}\n`);
          break;
        case 'completed':
          break;
      }
    };

    const result = await this.runLoop(task, onProgress);
    console.log(`LLM Response:\n${result}\n`);
    console.log("Task completed.");
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
