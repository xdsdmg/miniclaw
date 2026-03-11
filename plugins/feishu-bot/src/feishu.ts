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
