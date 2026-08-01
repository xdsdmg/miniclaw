/**
 * Feishu Bot Entry Point
 * 
 * Feishu bot main entry, responsible for:
 * 1. Parse CLI arguments to create Bot configuration
 * 2. Establish WebSocket long connection to receive Feishu messages
 * 3. Forward user messages to Miniclaw service for processing
 * 4. Send processing results back to Feishu users
 * 
 * Usage:
 *   miniclaw-feishu-bot \
 *     --app-id <Feishu App ID> \
 *     --app-secret <Feishu App Secret> \
 *     --server-url http://localhost:3000 \
 *     --server-api-key <Miniclaw Server API Key>
 * 
 * Environment Variables:
 *   MINICLAW_API_KEY - Miniclaw server authentication key (CLI argument --server-api-key takes precedence)
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { Command } from 'commander';
import { FeishuClient } from './feishu';
import { MiniclawClient } from './miniclaw';
import { BotConfig } from './types';

/**
 * CLI Program Configuration
 * Defines all required startup parameters
 */
const program = new Command();

/**
 * Configuration Options (CLI arguments take precedence over environment variables):
 *   --app-id         Feishu App ID (from Feishu Open Platform) or LARK_APP_ID env var
 *   --app-secret     Feishu App Secret or LARK_APP_SECRET env var
 *   --server-url     Miniclaw server URL (default: http://localhost:3000)
 *   --server-api-key Miniclaw server authentication key or MINICLAW_API_KEY env var
 * 
 * Required: app-id, app-secret, server-api-key (via CLI or env vars)
 */
program
  .name('miniclaw-feishu-bot')
  .description('Feishu bot for miniclaw')
  .version('1.0.0')
  .option('--app-id <id>', 'Feishu App ID')
  .option('--app-secret <secret>', 'Feishu App Secret')
  .option('--server-url <url>', 'Miniclaw server URL (default: http://localhost:3000)')
  .option('--server-api-key <key>', 'Miniclaw server API key')
  .option('--timeout <ms>', 'Task timeout in milliseconds (default: 600000)')
  .option('--plain-text', 'Send final replies as plain text instead of Markdown cards');

const options = program.parse(process.argv).opts();
const config: BotConfig = {
  appId: options.appId || process.env.LARK_APP_ID,
  appSecret: options.appSecret || process.env.LARK_APP_SECRET,
  port: 0,
  serverURL: options.serverUrl || 'http://localhost:3000',
  serverApiKey: options.serverApiKey || process.env.MINICLAW_API_KEY,
  timeout: options.timeout ? parseInt(options.timeout) : 600000,
  useMarkdown: !options.plainText,
};

// Validate required configuration
const missingConfig: string[] = [];
if (!config.appId) {
  missingConfig.push('app-id: Provide via --app-id CLI argument or LARK_APP_ID environment variable');
}
if (!config.appSecret) {
  missingConfig.push('app-secret: Provide via --app-secret CLI argument or LARK_APP_SECRET environment variable');
}
if (!config.serverApiKey) {
  missingConfig.push('server-api-key: Provide via --server-api-key CLI argument or MINICLAW_API_KEY environment variable');
}

if (missingConfig.length > 0) {
  console.error('[Feishu Bot] Error: Missing required configuration');
  missingConfig.forEach(msg => console.error(`- ${msg}`));
  process.exit(1);
}

// ========================================================================
// Unhandled Rejection Handler
// Prevents process crash on unhandled Promise rejections (Node.js 15+)
// ========================================================================
process.on('unhandledRejection', (reason) => {
  console.error(`[Feishu Bot] Unhandled rejection:`, reason instanceof Error ? reason.stack : reason);
});

const feishuClient = new FeishuClient(config);
const miniclaw = new MiniclawClient(config);

/**
 * Event Dispatcher
 * Register message receive event handling logic
 *
 * Processing Flow:
 *   1. Parse received message content
 *   2. Extract sender ID
 *   3. Call Miniclaw service to process task
 *   4. Send result back to Feishu user
 */

// Track last message time for connection health monitoring
let lastMessageTime = Date.now();

const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: any) => {
    const message = data.message;
    const msgType = message.message_type;

    lastMessageTime = Date.now();

    let userMessage = '';
    let senderId = '';

    if (msgType === 'text') {
      const content = JSON.parse(message.content);
      userMessage = content.text || '';
    }

    // Handle rich text (post) messages — extract plain text content
    if (msgType === 'post' && !userMessage) {
      try {
        const content = JSON.parse(message.content);
        // post content structure: { zh_cn: [[{ tag: "text", text: "..." }]] }
        const postContent = content?.zh_cn || content?.content;
        if (postContent && Array.isArray(postContent)) {
          userMessage = postContent
            .flatMap(para => Array.isArray(para) ? para.map(seg => seg.text || '') : [])
            .join('\n');
        }
      } catch {
        // fall through
      }
    }

    if (data.sender?.sender_id) {
      senderId = data.sender.sender_id.open_id;
    }

    if (!userMessage || !senderId) {
      console.log(`[Feishu Bot] No message content or sender ID (msgType=${msgType}, hasContent=${!!message?.content}, hasSender=${!!data.sender?.sender_id})`);
      return;
    }

    console.log(`[Feishu Bot] Received from ${senderId}: ${userMessage}`);

    setImmediate(async () => {
      try {
        // Acknowledge receipt immediately so the user isn't left waiting
        await feishuClient.sendMessage('open_id', senderId, '⏳ 已收到，正在处理...');

        let finalResult = '';
        const sentProgress = new Set<string>();

        for await (const chunk of miniclaw.executeStream(userMessage, senderId)) {
          if (chunk.startsWith('RESULT:')) {
            finalResult = chunk.substring(7).trim();
          } else if (chunk.startsWith('ERROR:')) {
            finalResult = chunk.substring(6).trim();
          } else if (chunk.startsWith('⚙️')) {
            // Push real-time tool-execution progress (deduplicated by tool name)
            const toolLine = chunk.trim();
            const toolName = toolLine.replace('⚙️ Executing ', '').replace(/[:：].*$/, '').trim();
            if (!sentProgress.has(toolName)) {
              sentProgress.add(toolName);
              await feishuClient.sendMessage('open_id', senderId, toolLine);
            }
          }
          // thinking / tool_result progress is skipped to avoid message spam
        }

        const responseText = finalResult || 'Task completed.';
        if (config.useMarkdown !== false) {
          await feishuClient.sendMarkdownMessage('open_id', senderId, responseText);
        } else {
          await feishuClient.sendMessage('open_id', senderId, responseText);
        }
        console.log('[Feishu Bot] Sent response to user');
      } catch (error) {
        console.error('[Feishu Bot] Error:', error);
        await feishuClient.sendMessage('open_id', senderId, `Error: ${error}`);
      }
    });
  },
});

/**
 * WebSocket Client
 * Establish WebSocket long connection with Feishu server
 * Used for real-time message event receiving
 */
const wsClient = new lark.WSClient({
  appId: config.appId,
  appSecret: config.appSecret,
}) as any;

console.log('[Feishu Bot] Starting WebSocket long connection...');

wsClient
  .start({
    eventDispatcher: eventDispatcher,
  })
  .then(() => {
    console.log('[Feishu Bot] WebSocket long connection established');
  })
  .catch((error: any) => {
    console.error('[Feishu Bot] WebSocket error:', error);
  });

// ========================================================================
// Connection Health Monitor
// Periodically logs WebSocket connection state and last message time.
// Helps diagnose silent connection drops without pong timeout detection.
// ========================================================================
setInterval(() => {
  const wsInstance = (wsClient as any).wsConfig?.getWSInstance?.();
  const readyState = wsInstance?.readyState;
  const readyStateLabel: Record<number, string> = {
    0: 'CONNECTING',
    1: 'OPEN',
    2: 'CLOSING',
    3: 'CLOSED',
  };
  const reconnectInfo = (wsClient as any).getReconnectInfo?.();
  const idleSeconds = Math.round((Date.now() - lastMessageTime) / 1000);

  console.log(`[Feishu Bot] Health:
  readyState: ${readyStateLabel[readyState] ?? 'unknown'} (${readyState})
  lastMessage: ${idleSeconds}s ago
  lastConnectTime: ${reconnectInfo?.lastConnectTime ? new Date(reconnectInfo.lastConnectTime).toISOString() : 'N/A'}
  nextConnectTime: ${reconnectInfo?.nextConnectTime ? new Date(reconnectInfo.nextConnectTime).toISOString() : 'N/A'}`);
}, 60_000);

process.on('SIGINT', () => {
  console.log('\n[Feishu Bot] Shutting down...');
  (wsClient as any).close();
  process.exit(0);
});
