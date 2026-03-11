/**
 * Miniclaw HTTP Server
 * 
 * Provides REST API for executing AI tasks, supporting sync and streaming responses
 * 
 * Endpoints:
 *   GET  /health              - Health check, returns server status
 *   POST /execute             - Sync task execution
 *   GET  /execute/stream      - Streaming task execution (Server-Sent Events)
 * 
 * Authentication:
 *   All /execute endpoints require Bearer Token authentication
 *   Format: Authorization: Bearer <API_KEY>
 */

import express, { Request, Response } from 'express';
import { executeTask, AgentConfig, ProgressEvent, ExecuteResult } from './agent';

/**
 * Server Configuration Interface
 * Defines all configuration parameters required for server startup
 */
export interface ServerConfig {
  /** Server listen port */
  port: number;
  /** Server bind address */
  host: string;
  /** API authentication key (for Bearer Token auth) */
  apiKey: string;
  /** Default task timeout (milliseconds) */
  defaultTimeout: number;
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** Default LLM provider */
  defaultProvider?: string;
  /** Default LLM API key */
  defaultApiKey?: string;
  /** Default LLM base URL */
  defaultBaseURL?: string;
}

/**
 * Concurrency Manager
 * Controls the number of simultaneously executing tasks, implements task queue and rate limiting
 * 
 * Usage:
 *   1. Call acquire() to get execution permit
 *   2. Execute task
 *   3. Call release() to release permit
 */
class ConcurrencyManager {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) { }

  /**
   * Acquire execution permit
   * If current running tasks < max, return immediately; otherwise add to waiting queue
   */
  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  /**
   * Release execution permit
   * Decrement running count, start next task if queue exists
   */
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Get current status
   * @returns Current running tasks and queued tasks count
   */
  getStatus(): { running: number; queued: number } {
    return { running: this.running, queued: this.queue.length };
  }
}

/**
 * Create Express application
 * Configure all routes, middleware and request handling logic
 * @param config Server configuration
 * @returns Configured Express application
 */
export function createServer(config: ServerConfig) {
  const app = express();
  const concurrencyManager = new ConcurrencyManager(config.maxConcurrent);

  app.use(express.json());

  app.use((req: Request, res: Response, next: express.NextFunction) => {
    const start = Date.now();
    const originalJson = res.json.bind(res);
    
    res.json = (body: unknown) => {
      console.log('\n=== HTTP Request/Response Log ===');
      console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
      console.log('Request Body:', JSON.stringify(req.body, null, 2));
      console.log('Response:', JSON.stringify(body, null, 2));
      console.log(`Response Time: ${Date.now() - start}ms`);
      console.log('===================================\n');
      return originalJson(body);
    };
    
    next();
  });

  /**
   * Bearer Token Authentication Middleware
   * Verify if Authorization header matches configured key
   */
  const authenticate = (req: Request, res: Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Missing or invalid Authorization header. Use: Bearer <API_KEY>',
      });
    }

    const token = authHeader.substring(7);
    if (token !== config.apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
      });
    }

    next();
  };

  /**
   * GET /health - Health check endpoint
   * Returns current server status including running tasks and max concurrent
   */
  app.get('/health', (req: Request, res: Response) => {
    const status = concurrencyManager.getStatus();
    res.json({
      status: 'ok',
      running: status.running,
      queued: status.queued,
      maxConcurrent: config.maxConcurrent,
    });
  });

  /**
   * POST /execute - Sync task execution endpoint
   * 
   * Request Body:
   *   {
   *     "task": "Task description",
   *     "config": {          // Optional, override default LLM config
   *       "provider": "openai",
   *       "apiKey": "...",
   *       "baseURL": "..."
   *     },
   *     "timeout": 120000    // Optional, override default timeout
   *   }
   * 
   * Response:
   *   {
   *     "success": true,
   *     "result": "Task result",
   *     "executionTime": 1234
   *   }
   */
  app.post('/execute', authenticate, async (req: Request, res: Response) => {
    const { task, config: requestConfig, timeout } = req.body;

    if (!task || typeof task !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid "task" field',
      });
    }

    const status = concurrencyManager.getStatus();
    if (status.running >= config.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: `Server is busy, please retry later. Current: ${status.running}/${config.maxConcurrent} tasks running`,
      });
    }

    await concurrencyManager.acquire();

    try {
      const agentConfig: AgentConfig = {
        provider: requestConfig?.provider || config.defaultProvider || 'openai',
        apiKey: requestConfig?.apiKey || config.defaultApiKey,
        baseURL: requestConfig?.baseURL || config.defaultBaseURL,
      };

      const effectiveTimeout = timeout || config.defaultTimeout;

      const result = await Promise.race([
        executeTask(task, agentConfig),
        new Promise<ExecuteResult>((_, reject) =>
          setTimeout(() => reject(new Error('Task timed out')), effectiveTimeout)
        ),
      ]);

      res.json(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      res.json({
        success: false,
        error: `Error: ${errorMsg}`,
        executionTime: 0,
      });
    } finally {
      concurrencyManager.release();
    }
  });

  /**
   * GET /execute/stream - Streaming task execution endpoint
   * Uses Server-Sent Events (SSE) for real-time task progress updates
   * 
   * Query Parameters:
   *   task      - Task description (required)
   *   provider  - LLM provider (optional)
   *   apiKey    - LLM API key (optional)
   *   baseURL   - LLM base URL (optional)
   *   timeout   - Timeout (optional)
   * 
   * Event Types:
   *   progress  - Task progress update
   *   result    - Task final result
   */
  app.get('/execute/stream', authenticate, async (req: Request, res: Response) => {
    const task = req.query.task as string;
    const provider = req.query.provider as string;
    const apiKey = req.query.apiKey as string;
    const baseURL = req.query.baseURL as string;
    const timeout = req.query.timeout ? parseInt(req.query.timeout as string) : config.defaultTimeout;

    if (!task) {
      return res.status(400).json({
        success: false,
        error: 'Missing "task" query parameter',
      });
    }

    const status = concurrencyManager.getStatus();
    if (status.running >= config.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: `Server is busy, please retry later. Current: ${status.running}/${config.maxConcurrent} tasks running`,
      });
    }

    await concurrencyManager.acquire();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const agentConfig: AgentConfig = {
        provider: provider || config.defaultProvider || 'openai',
        apiKey: apiKey || config.defaultApiKey,
        baseURL: baseURL || config.defaultBaseURL,
      };

      const executePromise = executeTask(task, agentConfig, (event: ProgressEvent) => {
        sendEvent('progress', event);
      });

      const timeoutPromise = new Promise<ExecuteResult>((_, reject) => {
        setTimeout(() => reject(new Error('Task timed out')), timeout);
      });

      const result = await Promise.race([executePromise, timeoutPromise]);

      sendEvent('result', {
        success: result.success,
        result: result.result,
        error: result.error,
        executionTime: result.executionTime,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      sendEvent('result', {
        success: false,
        error: `Error: ${errorMsg}`,
        executionTime: 0,
      });
    } finally {
      concurrencyManager.release();
      res.end();
    }
  });

  return app;
}

/**
 * Start HTTP Server
 * Create and start Express application, listen on specified port
 * @param config Server configuration
 */
export function startServer(config: ServerConfig) {
  const app = createServer(config);

  app.listen(config.port, config.host, () => {
    console.log(`Miniclaw server started on http://${config.host}:${config.port}`);
    console.log(`API Key: ${config.apiKey}`);
    console.log(`Max concurrent tasks: ${config.maxConcurrent}`);
    console.log(`Default timeout: ${config.defaultTimeout}ms`);
  });
}
