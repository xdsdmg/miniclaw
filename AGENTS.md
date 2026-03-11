# AGENTS.md - Miniclaw Development Guide

This document provides guidelines and commands for agents working on the miniclaw codebase.

## Project Overview

Miniclaw is a minimal AI agent that orchestrates LLMs and tools to complete tasks. It supports multiple LLM providers (OpenAI, DeepSeek, Kimi, Qwen) and provides both CLI and HTTP server interfaces.

## Build Commands

```bash
# Build the TypeScript project
npm run build

# Run in development mode (using ts-node)
npm run dev

# Start the CLI
npm start

# Run the server
node dist/cli.js server -a <API_KEY> --default-api-key <LLM_KEY> --provider deepseek
```

## Testing

This project currently has no formal test suite. The test.sh script is for manual testing:

```bash
# Run manual tests
./test.sh
```

When adding tests, use a testing framework like Jest or Vitest and place tests in `src/**/*.test.ts`.

## Code Style Guidelines

### TypeScript Configuration

The project uses strict TypeScript with the following settings:
- Target: ES2020
- Module: CommonJS
- Strict mode enabled
- ESModuleInterop enabled

### Imports

- Use relative imports for local modules: `import { Agent } from './agent';`
- Use named exports where possible
- Group imports: external first, then local

```typescript
// External imports
import express, { Request, Response } from 'express';
import OpenAI from 'openai';

// Local imports
import { Agent } from './agent';
import { executeTask, AgentConfig } from './agent';
```

### Naming Conventions

- **Files**: kebab-case (e.g., `tool-executor.ts`, `tools-schema.ts`)
- **Classes**: PascalCase (e.g., `Agent`, `LLMProvider`, `ToolExecutor`)
- **Interfaces**: PascalCase with descriptive names (e.g., `AgentConfig`, `ExecuteResult`)
- **Types**: PascalCase (e.g., `ProgressStage`)
- **Functions**: camelCase (e.g., `executeTask`, `startServer`)
- **Constants**: camelCase or UPPER_SNAKE_CASE for configuration constants

### Interfaces and Types

- Define interfaces for all configuration objects
- Use explicit return types for functions when not obvious
- Use `Record<string, unknown>` for generic object types

```typescript
export interface AgentConfig {
  provider: string;
  apiKey?: string;
  baseURL?: string;
}

export interface ExecuteResult {
  success: boolean;
  result?: string;
  error?: string;
  executionTime: number;
}

export type ProgressStage = 'thinking' | 'executing' | 'tool_result' | 'completed';
```

### Error Handling

- Always check error type: `error instanceof Error ? error.message : String(error)`
- Use try-catch blocks for async operations
- Return structured error responses in API endpoints
- Include error stack traces in development for debugging

```typescript
try {
  const result = await someAsyncOperation();
  return result;
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    error: `Error: ${errorMsg}`,
  };
}
```

### Class Structure

- Use private fields with `private` keyword
- Use constructor parameter properties when appropriate
- Keep methods focused and small

```typescript
export class LLMProvider {
  private client: OpenAI;
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({ ... });
  }
}
```

### Async/Await

- Always use async/await over raw promises
- Use `Promise.race()` for timeout handling
- Always handle promise rejections with try-catch

```typescript
async executeTask(task: string): Promise<ExecuteResult> {
  try {
    const result = await this.llm.generateResponse(task);
    return result;
  } catch (error) {
    // Handle error
  }
}
```

### Express Server Patterns

- Use middleware for authentication
- Return consistent JSON response structure
- Include proper HTTP status codes
- Use async route handlers with try-catch

```typescript
app.post('/execute', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await executeTask(task, config);
    res.json(result);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMsg });
  }
});
```

### Safety and Security

- Always validate user input
- Implement rate limiting for API endpoints
- Use authentication middleware for protected routes
- Sanitize error messages before returning to clients
- Never expose sensitive information in error responses

### CLI Commands

- Use Commander.js for CLI parsing
- Define clear option defaults
- Provide helpful error messages
- Support both short (`-a`) and long (`--api-key`) option forms

```typescript
program
  .command('server')
  .option('-a, --api-key <key>', 'API key for authentication (required)')
  .option('-p, --port <port>', 'Port to listen', '3000')
  .action(async (options) => {
    const apiKey = options.apiKey || process.env.MINICLAW_API_KEY;
    if (!apiKey) {
      console.error('Error: --api-key is required');
      process.exit(1);
    }
  });
```

### Formatting

- Use 2 spaces for indentation
- Add spaces after commas and around operators
- Use single quotes for strings
- Add trailing commas in multi-line objects/arrays

### Comments

- Add JSDoc comments for public APIs
- Explain complex logic with inline comments
- Document configuration options
- When generating or modifying code, always include appropriate comments to enhance readability and maintainability

### File Organization

```
src/
├── cli.ts         # CLI entry point
├── server.ts     # HTTP server
├── agent.ts      # Main agent logic
├── llm.ts        # LLM provider abstraction
├── tools.ts      # Tool execution
└── tools-schema.ts # Tool definitions
```

### Pull Request Guidelines

1. Run `npm run build` before submitting
2. Ensure no TypeScript errors
3. Test manually if possible
4. Update documentation if needed
5. Keep changes focused and minimal
