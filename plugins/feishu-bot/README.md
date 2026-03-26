# Feishu Bot Plugin for miniclaw

A Feishu (飞书) bot plugin that handles direct messages (DMs) between users and miniclaw.

## Architecture

```
┌─────────────────┐     HTTP      ┌─────────────────┐     LLM      ┌─────────┐
│  Feishu User   │ ◄────────────► │  Feishu Bot     │ ◄─────────► │ Miniclaw│
│                 │   Messages    │  (This Plugin)  │   Tasks    │ Server  │
└─────────────────┘               └─────────────────┘             └─────────┘
```

**Note**: The Feishu Bot acts as a client of the Miniclaw service, only responsible for:
1. Receiving user messages
2. Forwarding messages to Miniclaw server
3. Returning processing results to users

**LLM configuration is managed by the Miniclaw server**, no configuration needed on the Bot side.

## Installation

```bash
cd plugins/feishu-bot
npm install
npm run build
```

### Dependencies

The bot uses the following key dependencies:
- `@larksuiteoapi/node-sdk` - Feishu Open Platform SDK
- `commander` - CLI argument parsing
- `dotenv` - Environment variable support
- `typescript` - TypeScript compiler (dev dependency)
- `@types/node` - Node.js type definitions (dev dependency)

## How It Works

1. Bot connects to Feishu via WebSocket long connection
2. Receives direct messages from users
3. Sends task to miniclaw HTTP server
4. Receives result from server
5. Sends result back to user via Feishu API

## Configuration

### Prerequisites

1. Start the miniclaw HTTP server first with LLM configuration:

```bash
# Terminal 1: Start miniclaw server
# LLM configuration is managed on the server side, here using deepseek as example
miniclaw server --api-key your-secret-key --port 3000 \
  --provider deepseek --llm-api-key YOUR_LLM_API_KEY
```

### Feishu Platform Setup

1. Create an app at [Feishu Open Platform](https://open.feishu.cn/app)
2. Enable "Use Bot" feature in app settings
3. Add the following permissions:
   - `im:message` - Send and receive messages
   - `im:message.p2p_msg:readonly` - Read direct messages
   - `im:message:send_as_bot` - Send messages as bot
4. Configure Event Subscription:
   - Go to "Event Subscription" page
   - Select "Use long connection to receive events (WebSocket)"
   - The SDK will automatically handle the connection
   - Add event: `im.message.receive_v1`
5. Publish the app

### Running the Bot

The bot uses WebSocket long connection mode, no public URL required:

#### Option 1: Using CLI Arguments
```bash
npm start -- \
  --app-id <FEISHU_APP_ID> \
  --app-secret <FEISHU_APP_SECRET> \
  --server-url http://localhost:3000 \
  --server-api-key your-secret-key
```

#### Option 2: Using Environment Variables
```bash
# Set environment variables
export LARK_APP_ID=your-feishu-app-id
export LARK_APP_SECRET=your-feishu-app-secret
export MINICLAW_API_KEY=your-miniclaw-server-key

# Run bot (no arguments needed)
npm start
```

#### Option 3: Mixed Configuration
```bash
export LARK_APP_ID=your-feishu-app-id
export MINICLAW_API_KEY=your-miniclaw-server-key

npm start -- --app-secret your-feishu-app-secret
```

**Note**: The bot requires the miniclaw server to be running first. See [Prerequisites](#prerequisites).

**Initial Setup in Feishu Console**:
1. Start the bot first
2. Go to Feishu Console → Your App → Event Subscription
3. Select "Use long connection to receive events (WebSocket)"
4. Add event: `im.message.receive_v1`
5. Click Save - the SDK will establish WebSocket connection automatically

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--app-id` | Feishu App ID (from Feishu Open Platform) | `LARK_APP_ID` env var |
| `--app-secret` | Feishu App Secret | `LARK_APP_SECRET` env var |
| `--server-url` | Miniclaw server URL | `http://localhost:3000` |
| `--server-api-key` | Miniclaw server API key | `MINICLAW_API_KEY` env var |

**Note**: Required configuration can be provided via CLI arguments or environment variables. The bot will validate all required parameters on startup and provide helpful error messages.

## Supported LLM Providers

LLM providers are configured on the Miniclaw server side. See [miniclaw server documentation](../../README.md) for supported providers.

- `openai` - OpenAI (default)
- `deepseek` - DeepSeek
- `kimi` - Moonshot AI (Kimi)
- `qwen` - Alibaba Qwen

## Configuration Validation

The bot performs comprehensive configuration validation on startup:

- Validates that required Feishu credentials are provided (via CLI or environment variables)
- Checks Miniclaw server API key configuration
- Provides clear error messages for missing configuration
- Suggests how to provide missing parameters (CLI argument or environment variable)

Example error output:
```
[Feishu Bot] Error: Missing required configuration
- app-id: Provide via --app-id CLI argument or LARK_APP_ID environment variable
- app-secret: Provide via --app-secret CLI argument or LARK_APP_SECRET environment variable
- server-api-key: Provide via --server-api-key CLI argument or MINICLAW_API_KEY environment variable
```

## Usage

1. Start the miniclaw server with your preferred LLM provider and API key (see Prerequisites)
2. Start the bot with your Feishu credentials
3. Add the bot to Feishu and start a direct message conversation
4. Send a text message to the bot
5. Bot executes the task via miniclaw server and returns the result
