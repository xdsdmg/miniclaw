/**
 * Feishu Client - Feishu API Client
 * 
 * Encapsulates Feishu Open Platform SDK, providing message sending and event parsing functionality
 * 
 * Main Features:
 *   - Send messages to users
 *   - Parse message events
 *   - Extract message content and user ID
 *   - Handle URL verification challenge
 */

import * as lark from '@larksuiteoapi/node-sdk';
import { BotConfig, FeishuMessageEvent } from './types';

/**
 * Feishu Client Class
 * Initializes client using Feishu SDK, provides message operation interface
 */
export class FeishuClient {
  private client: lark.Client;

  constructor(config: BotConfig) {
    this.client = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      disableTokenCache: false,
    });
  }

  /**
   * Send Message
   * Send text message to specified user via Feishu IM API
   *
   * @param receiveIdType Receiver ID type (open_id | user_id | union_id)
   * @param receiveId     Receiver ID
   * @param content       Message content (text)
   */
  async sendMessage(
    receiveIdType: 'open_id' | 'user_id' | 'union_id',
    receiveId: string,
    content: string
  ): Promise<void> {
    await this.client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    });
  }

  /** Maximum markdown length per card (Feishu card content limits) */
  private static readonly MARKDOWN_MAX_LEN = 20000;

  /**
   * Send Markdown Message (interactive card)
   * Renders markdown in a Feishu interactive card for a richer visual experience.
   * Supports: headings, bold/italic, links, inline code, fenced code blocks, lists.
   *
   * Falls back to plain text if the content is empty or non-renderable.
   *
   * @param receiveIdType Receiver ID type (open_id | user_id | union_id)
   * @param receiveId     Receiver ID
   * @param content       Markdown content
   */
  async sendMarkdownMessage(
    receiveIdType: 'open_id' | 'user_id' | 'union_id',
    receiveId: string,
    content: string
  ): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      await this.sendMessage(receiveIdType, receiveId, content);
      return;
    }

    // Truncate very long content to avoid exceeding card size limits
    const body = trimmed.length > FeishuClient.MARKDOWN_MAX_LEN
      ? trimmed.slice(0, FeishuClient.MARKDOWN_MAX_LEN) + '\n\n…（内容过长已截断）'
      : trimmed;

    // NOTE: No escaping of `{{ }}` — for a standalone card sent via the message
    // API (no template binding), curly braces are literal text. Escaping would
    // corrupt legitimate content like template literals in code blocks.
    const card = {
      elements: [
        { tag: 'markdown', content: body },
      ],
    };

    await this.client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  }

  /**
   * Parse Message Event
   * Check if raw data is a valid message receive event
   * 
   * @param data Raw event data
   * @returns Parsed message event or null
   */
  parseMessageEvent(data: any): FeishuMessageEvent | null {
    try {
      if (data.header?.event_type === 'im.message.receive_v1') {
        return data as FeishuMessageEvent;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract Message Content
   * Parse and extract text content from message event
   * 
   * @param event Message event object
   * @returns Extracted text content
   */
  extractMessageContent(event: FeishuMessageEvent): string {
    try {
      const content = JSON.parse(event.event.content);
      return content.text || '';
    } catch {
      return '';
    }
  }

  /**
   * Get User ID
   * Extract sender ID from message event (prefer open_id)
   * 
   * @param event Message event object
   * @returns User ID (open_id | user_id | union_id)
   */
  getUserId(event: FeishuMessageEvent): string | undefined {
    return (
      event.event.sender.sender_id.open_id ||
      event.event.sender.sender_id.user_id ||
      event.event.sender.sender_id.union_id
    );
  }

  /**
   * Check if URL Verification Challenge
   * Used for server verification in HTTP mode
   * 
   * @param data Raw event data
   * @returns Whether it is a verification challenge
   */
  isVerificationChallenge(data: any): boolean {
    return data?.event?.type === 'url_verification';
  }

  /**
   * Get Verification Challenge String
   * Return the challenge answer to send back to Feishu
   * 
   * @param data Raw event data
   * @returns Challenge string
   */
  getVerificationChallenge(data: any): string {
    return data?.event?.challenge || '';
  }
}
