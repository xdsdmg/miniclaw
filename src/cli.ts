#!/usr/bin/env node

/**
 * Miniclaw CLI Entry Point
 * 
 * Provides command-line interface with two running modes:
 * 1. execute command - Execute a single task directly
 * 2. server command - Start HTTP server
 * 
 * Usage:
 *   miniclaw "<task>"                    # Execute task directly
 *   miniclaw execute "<task>"           # Execute with subcommand
 *   miniclaw server -k <api-key>         # Start HTTP server
 */

import { Command } from 'commander';
import { Agent } from './agent';
import { startServer } from './server';

/**
 * CLI program main object
 * Configures global options and subcommands
 */
const program = new Command();

program
  .name('miniclaw')
  .description('A minimal AI agent that orchestrates LLMs and tools to complete tasks')
  .version('1.0.0')
  .enablePositionalOptions();

/**
 * Execute subcommand
 * Execute AI task directly, LLM analyzes and calls tools to complete the task
 * 
 * Options:
 *   -p, --provider <provider>  LLM provider (deepseek, kimi, qwen, openai), default: openai
 *   -k, --api-key <key>        LLM API key
 *   -b, --base-url <url>       OpenAI-compatible API base URL
 */
program
  .command('execute')
  .description('Execute a task directly')
  .argument('<task>', 'The task for the AI agent to complete')
  .option('-p, --provider <provider>', 'LLM provider (deepseek, kimi, qwen, openai)', 'openai')
  .option('-k, --api-key <key>', 'API key for the LLM provider')
  .option('-b, --base-url <url>', 'Base URL for OpenAI-compatible APIs')
  .action(async (task: string, options: any) => {
    try {
      const agent = new Agent({
        provider: options.provider,
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });

      await agent.execute(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Server subcommand
 * Start HTTP server providing REST API
 * 
 * Options:
 *   -p, --port <port>              Listen port, default: 3000
 *   -h, --host <host>              Bind address, default: 0.0.0.0
 *   -k, --api-key <key>            Server authentication API key (required)
 *   -t, --timeout <ms>            Default timeout, default: 120000ms
 *   -c, --max-concurrent <n>      Max concurrent tasks, default: 5
 *   --provider <provider>          Default LLM provider
 *   --default-api-key <key>        Default LLM API key
 *   --default-base-url <url>       Default LLM base URL
 * 
 * Environment Variables:
 *   MINICLAW_API_KEY               Server authentication key (can also be set via -k)
 */
program
  .command('server')
  .description('Start miniclaw HTTP server')
  .passThroughOptions()
  .option('-p, --port <port>', 'Port to listen', '3000')
  .option('-h, --host <host>', 'Host to bind', '0.0.0.0')
  .option('-k, --api-key <key>', 'API key for authentication (required)')
  .option('-t, --timeout <ms>', 'Default timeout in milliseconds', '120000')
  .option('-c, --max-concurrent <n>', 'Maximum concurrent tasks', '5')
  .option('--provider <provider>', 'Default LLM provider')
  .option('--default-api-key <key>', 'Default LLM API key')
  .option('--default-base-url <url>', 'Default LLM base URL')
  .action(async (options: any) => {
    console.log(`options: ${JSON.stringify(options)}`);

    const apiKey = options.apiKey || process.env.MINICLAW_API_KEY;
    if (!apiKey) {
      console.error('Error: --api-key is required (or set MINICLAW_API_KEY environment variable)');
      process.exit(1);
    }

    startServer({
      port: parseInt(options.port),
      host: options.host,
      apiKey,
      defaultTimeout: parseInt(options.timeout),
      maxConcurrent: parseInt(options.maxConcurrent),
      defaultProvider: options.provider,
      defaultApiKey: options.defaultApiKey,
      defaultBaseURL: options.defaultBaseUrl,
    });
  });

/**
 * Default command (when no subcommand)
 * Shortcut: miniclaw "<task>" is equivalent to miniclaw execute "<task>"
 */
program
  .argument('<task>', 'The task for the AI agent to complete')
  .option('-p, --provider <provider>', 'LLM provider (deepseek, kimi, qwen, openai)', 'openai')
  .option('-k, --api-key <key>', 'API key for the LLM provider')
  .option('-b, --base-url <url>', 'Base URL for OpenAI-compatible APIs')
  .action(async (task: string, options: any) => {
    try {
      const agent = new Agent({
        provider: options.provider,
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
      });

      await agent.execute(task);
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
