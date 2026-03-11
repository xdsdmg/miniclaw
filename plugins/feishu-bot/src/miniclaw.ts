/**
 * Miniclaw Client - Miniclaw Service Client
 * 
 * Encapsulates interaction logic with Miniclaw HTTP server, providing:
 * - Sync task execution (execute)
 * - Streaming task execution (executeStream)
 * 
 * Note: This client is only responsible for communication with Miniclaw server.
 * LLM configuration is managed by Miniclaw server.
 */

/**
 * Miniclaw Client Configuration
 * Only needs server address and authentication info
 */
export interface MiniclawClientConfig {
  /** Miniclaw server URL */
  serverURL?: string;
  /** Miniclaw server authentication key */
  serverApiKey?: string;
  /** Request timeout in milliseconds, default: 120000 */
  timeout?: number;
}

/**
 * Miniclaw Client Class
 * Communicates with Miniclaw HTTP server to execute AI tasks
 */
export class MiniclawClient {
  private config: MiniclawClientConfig;

  constructor(config: MiniclawClientConfig) {
    this.config = {
      ...config,
      timeout: config.timeout || 120000,
    };
  }

  /**
   * Execute Task Synchronously
   * Send task request to Miniclaw server, wait for completion and return result
   * 
   * @param task Task description
   * @returns Execution result text
   */
  async execute(task: string): Promise<string> {
    const serverURL = this.config.serverURL || 'http://localhost:3000';
    const apiKey = this.config.serverApiKey || process.env.MINICLAW_API_KEY;

    if (!apiKey) {
      return 'Error: No API key configured for miniclaw server';
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${serverURL}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          task,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json() as { success: boolean; result?: string; error?: string };

      if (data.success) {
        return data.result || 'Task completed.';
      } else {
        return data.error || 'Unknown error occurred';
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'Error: Task timed out';
      }
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Execute Task with Streaming
   * Get real-time task execution progress via Server-Sent Events
   * 
   * Progress Event Types:
   *   🤔 thinking   - LLM is thinking
   *   ⚙️ executing  - Tool is being executed
   *   📋 tool_result - Tool execution completed
   *   ✅ completed  - Task completed
   * 
   * @param task Task description
   * @yield Progress event messages
   */
  async *executeStream(task: string): AsyncGenerator<string> {
    const serverURL = this.config.serverURL || 'http://localhost:3000';
    const apiKey = this.config.serverApiKey || process.env.MINICLAW_API_KEY;

    if (!apiKey) {
      yield 'Error: No API key configured for miniclaw server';
      return;
    }

    const params = new URLSearchParams({
      task,
    });

    try {
      const response = await fetch(`${serverURL}/execute/stream?${params}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const error = await response.json() as { error?: string };
        yield error.error || `Error: HTTP ${response.status}`;
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield 'Error: Failed to read response';
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.stage === 'thinking') {
                yield `🤔 ${data.message}\n`;
              } else if (data.stage === 'executing') {
                yield `⚙️ ${data.message}\n`;
              } else if (data.stage === 'tool_result') {
                yield `📋 Tool result: ${data.toolResult?.substring(0, 100)}...\n`;
              } else if (data.stage === 'completed') {
                yield `✅ ${data.message}\n`;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      yield `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
