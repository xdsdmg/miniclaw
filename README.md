# miniclaw

A minimal AI agent that orchestrates LLMs and tools to complete tasks.

## Features

- Support for multiple LLM providers (OpenAI, DeepSeek, Kimi, Qwen, and other OpenAI-compatible APIs)
- Tool execution capabilities for bash commands and Python scripts
- CLI interface for task orchestration
- Basic safety controls for tool execution
- HTTP Server API for programmatic access
- Server-Sent Events (SSE) for streaming execution progress

## Installation

```bash
npm install -g
```

## Usage

```bash
# Using OpenAI (default)
miniclaw "What is in the current directory?" -k YOUR_OPENAI_API_KEY

# Using DeepSeek
miniclaw "Analyze the code in src/ directory" -p deepseek -k YOUR_DEEPSEEK_API_KEY

# Using a custom OpenAI-compatible API
miniclaw "Create a file with today's date" -b https://your-custom-api.com/v1 -k YOUR_API_KEY
```

## Supported Providers

- `openai`: OpenAI API (default)
- `deepseek`: DeepSeek API
- `kimi`: Kimi API (Moonshot AI)
- `qwen`: Qwen API (Alibaba Tongyi)
- Custom OpenAI-compatible APIs via the `--base-url` option

## Safety Controls

The tool execution includes basic safety controls:
- Blocking dangerous bash commands (sudo, rm -rf, etc.)
- Limiting Python imports to safer modules
- Timeouts for command execution
- Output size limits

## HTTP Server

### Quick Start

```bash
# Build the project first (if not built)
npm run build

# Start server
node dist/cli.js server -k your-secret-key --port 3000 \
  --provider deepseek --default-api-key YOUR_DEEPSEEK_API_KEY

# Or use environment variables
export MINICLAW_API_KEY=your-secret-key
node dist/cli.js server --port 3000 --provider deepseek --default-api-key YOUR_DEEPSEEK_API_KEY
```

After starting, check health:
```bash
curl http://localhost:3000/health -H "Authorization: Bearer your-secret-key"
```

### Server Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port` | Port to listen | `3000` |
| `--host` | Host to bind | `0.0.0.0` |
| `-k`, `--api-key` | API authentication key (required) | - |
| `--timeout` | Default timeout (ms) | `120000` |
| `--max-concurrent` | Max concurrent tasks | `5` |
| `--provider` | Default LLM provider | `openai` |
| `--default-api-key` | Default LLM API key | - |
| `--default-base-url` | Default LLM base URL | - |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/execute` | Execute task (JSON) |
| GET | `/execute/stream` | Execute task (SSE streaming) |

### API Authentication

All `/execute` requests require `Authorization: Bearer <API_KEY>` header.

### Example Request

```bash
curl -X POST http://localhost:3000/execute \
  -H "Authorization: Bearer your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "task": "List files in current directory",
    "config": {
      "provider": "deepseek",
      "apiKey": "sk-xxx"
    }
  }'
```

### SSE Streaming

To receive real-time progress updates:

```bash
curl -N "http://localhost:3000/execute/stream?task=List+files&provider=deepseek&apiKey=sk-xxx" \
  -H "Authorization: Bearer your-secret-key"
```

Events:
- `progress`: Execution progress (thinking, executing, tool_result)
- `result`: Final result

## Architecture

- `cli.ts`: Command-line interface (supports `execute` and `server` commands)
- `server.ts`: HTTP server for API access
- `agent.ts`: Main agent logic that orchestrates LLM and tools
- `llm.ts`: LLM provider abstraction and implementation
- `tools.ts`: Tool execution with safety controls
