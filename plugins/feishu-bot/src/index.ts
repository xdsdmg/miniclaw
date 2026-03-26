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
  .option('--server-api-key <key>', 'Miniclaw server API key');

const options = program.parse(process.argv).opts();
const config: BotConfig = {
  appId: options.appId || process.env.LARK_APP_ID,
  appSecret: options.appSecret || process.env.LARK_APP_SECRET,
  port: 0,
  serverURL: options.serverUrl || 'http://localhost:3000',
  serverApiKey: options.serverApiKey || process.env.MINICLAW_API_KEY,
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
const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data: any) => {
    const message = data.message;
    const msgType = message.message_type;

    let userMessage = '';
    let senderId = '';

    if (msgType === 'text') {
      const content = JSON.parse(message.content);
      userMessage = content.text || '';
    }

    if (data.sender?.sender_id) {
      senderId = data.sender.sender_id.open_id;
    }

    if (!userMessage || !senderId) {
      console.log('[Feishu Bot] No message content or sender ID');
      return;
    }

    console.log(`[Feishu Bot] Received from ${senderId}: ${userMessage}`);

    setImmediate(async () => {
      try {
        const result = await miniclaw.execute(userMessage);
        const responseText = result || 'Task completed.';
        await feishuClient.sendMessage('open_id', senderId, responseText);
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

process.on('SIGINT', () => {
  console.log('\n[Feishu Bot] Shutting down...');
  (wsClient as any).close();
  process.exit(0);
});
