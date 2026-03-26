# AGENTS.md - Miniclaw Development Guide

This document provides comprehensive guidelines and technical details for AI coding agents working on the miniclaw codebase.

## Project Overview

Miniclaw is a minimal AI agent that orchestrates LLMs and tools to complete tasks. It supports multiple LLM providers (OpenAI, DeepSeek, Kimi, Qwen) and provides both CLI and HTTP server interfaces with streaming capabilities.

### Key Features
- Multi-provider LLM support with unified API interface
- Tool execution capabilities (Bash commands, Python scripts)
- Comprehensive safety controls for dangerous operations
- HTTP server with REST API and Server-Sent Events (SSE) streaming
- CLI interface with both direct execution and server modes
- Concurrent task management with configurable limits

## Technology Stack

- **Language**: TypeScript (ES2020 target, CommonJS modules)
- **Runtime**: Node.js
- **Key Dependencies**:
  - `openai` - LLM provider SDK
  - `commander` - CLI argument parsing
  - `zod` - Schema validation
  - `express` - HTTP server framework
- **Build Tool**: TypeScript compiler (`tsc`)
- **Development**: `ts-node` for direct TypeScript execution

## Project Structure

```
src/
├── cli.ts          # CLI entry point with Commander.js
├── server.ts       # Express HTTP server with SSE support
├── agent.ts        # Core AI agent logic and execution loop
├── llm.ts          # LLM provider abstraction layer
├── tools.ts        # Tool execution with safety controls
└── tools-schema.ts # Tool definitions for LLM consumption
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Run in development mode (using ts-node)
npm run dev

# Start CLI directly
npm start

# Run built CLI
node dist/cli.js

# Start HTTP server
node dist/cli.js server -k <API_KEY> --provider deepseek --default-api-key <LLM_KEY>
```

## Architecture Details

### Core Components

1. **Agent (`agent.ts`)**
   - Main execution loop with LLM interaction
   - Tool call handling and result processing
   - Progress event emission for streaming
   - Maximum iteration limit (10) to prevent infinite loops

2. **LLM Provider (`llm.ts`)**
   - Unified interface for multiple LLM providers
   - Automatic fallback when tools are not supported
   - Provider-specific base URLs and model selection
   - Environment variable model overrides

3. **Tool Executor (`tools.ts`)**
   - Bash command execution with safety filtering
   - Python script execution with temporary file management
   - Comprehensive dangerous pattern detection
   - Timeout and buffer size limits

4. **HTTP Server (`server.ts`)**
   - Express.js-based REST API
   - Bearer token authentication
   - Concurrency management with queue system
   - SSE streaming for real-time progress updates

### Safety Controls

The project implements multiple layers of safety controls:

**Bash Command Safety**:
- Blocks dangerous commands (sudo, rm -rf, system modifications)
- Timeout limits (30 seconds)
- Output buffer limits (10MB)

**Python Code Safety**:
- Restricts dangerous imports (os, sys, subprocess, socket)
- Blocks eval/exec operations
- Prevents file system access patterns
- Temporary file cleanup

**API Security**:
- Bearer token authentication required
- Rate limiting through concurrency controls
- Input validation and sanitization

## Configuration

### TypeScript Configuration
- Target: ES2020
- Module: CommonJS
- Strict mode enabled
- Source maps and declarations generated
- Output directory: `dist/`

### Environment Variables
- `OPENAI_API_KEY` - OpenAI API key
- `DEEPSEEK_MODEL` - Override DeepSeek model
- `KIMI_MODEL` - Override Kimi model
- `QWEN_MODEL` - Override Qwen model
- `OPENAI_MODEL` - Override OpenAI model
- `MINICLAW_API_KEY` - Server authentication key

## Code Style and Conventions

### Naming Conventions
- **Files**: kebab-case (e.g., `tools-schema.ts`)
- **Classes**: PascalCase (e.g., `Agent`, `LLMProvider`)
- **Interfaces**: PascalCase with descriptive names (e.g., `AgentConfig`)
- **Functions**: camelCase (e.g., `executeTask`, `generateResponse`)
- **Constants**: camelCase or UPPER_SNAKE_CASE

### Import Organization
```typescript
// External imports first
import express, { Request, Response } from 'express';
import OpenAI from 'openai';

// Local imports second
import { Agent } from './agent';
import { executeTask, AgentConfig } from './agent';
```

### Error Handling Pattern
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

### Interface Definitions
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
```

## API Endpoints

### Health Check
- `GET /health` - Returns server status and concurrency info

### Task Execution
- `POST /execute` - Synchronous task execution with JSON response
- `GET /execute/stream` - Streaming execution with SSE events

### Authentication
All `/execute` endpoints require Bearer token authentication:
```
Authorization: Bearer <API_KEY>
```

## Testing Strategy

Currently, the project has no formal test suite. The package.json indicates:
```json
"test": "echo \"No tests yet, but compilation passes\""
```

**Recommended Testing Approach**:
- Use Jest or Vitest for unit testing
- Place tests in `src/**/*.test.ts` files
- Test individual components (Agent, LLMProvider, ToolExecutor)
- Mock external dependencies (LLM API calls, file system operations)
- Include integration tests for server endpoints

## Deployment Considerations

### Build Process
1. Run `npm run build` to compile TypeScript
2. Output goes to `dist/` directory
3. Main entry point: `dist/cli.js`
4. Binary available as `miniclaw` command when installed globally

### Server Deployment
- Configure appropriate timeout values based on expected task complexity
- Set reasonable concurrency limits based on server resources
- Use environment variables for sensitive configuration
- Implement proper logging and monitoring
- Consider containerization for consistent deployment

### Security Best Practices
- Never commit API keys to version control
- Use strong, unique API keys for server authentication
- Regularly update dependencies for security patches
- Monitor and limit resource usage per task
- Implement proper input validation and sanitization

## Development Workflow

1. **Before Making Changes**:
   - Run `npm run build` to ensure current state compiles
   - Review existing code style and patterns
   - Check for any open issues or TODOs in the code

2. **During Development**:
   - Use `npm run dev` for rapid development cycles
   - Follow established code style conventions
   - Add appropriate JSDoc comments for public APIs
   - Test changes manually with both CLI and server modes

3. **Before Submitting**:
   - Run `npm run build` to ensure no TypeScript errors
   - Test the CLI functionality
   - Test the server endpoints
   - Update documentation if needed
   - Keep changes focused and minimal

## Common Development Tasks

### Adding a New LLM Provider
1. Update provider list in `llm.ts`
2. Add base URL configuration
3. Add model name logic in `getModelName()`
4. Update CLI help text and documentation

### Adding a New Tool
1. Define tool schema in `tools-schema.ts`
2. Implement execution method in `tools.ts`
3. Add safety checks for dangerous operations
4. Update tool executor dispatch logic

### Modifying Server Behavior
1. Update server configuration interface
2. Modify route handlers in `server.ts`
3. Update authentication or concurrency logic as needed
4. Test with both sync and streaming endpoints

This guide should serve as the primary reference for understanding and contributing to the miniclaw project.