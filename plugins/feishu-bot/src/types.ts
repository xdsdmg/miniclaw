/**
 * Types - Feishu Bot Type Definitions
 * 
 * Defines data structures needed for interacting with Feishu API
 */

/**
 * Bot Startup Configuration
 * Contains Feishu app credentials and Miniclaw service connection info
 * 
 * Note: Feishu Bot is a client of Miniclaw service, only responsible for
 * forwarding user messages to Miniclaw server for processing. LLM configuration
 * is managed by Miniclaw server.
 */
export interface BotConfig {
  /** Feishu App ID */
  appId: string;
  /** Feishu App Secret */
  appSecret: string;
  /** Reserved field (for HTTP mode) */
  port: number;
  /** Miniclaw server URL */
  serverURL?: string;
  /** Miniclaw server authentication key */
  serverApiKey?: string;
}

/**
 * Feishu Message Event
 * Event data pushed by Feishu server when user sends a message
 * 
 * Key Fields:
 *   event.sender.sender_id.open_id - User Open ID
 *   event.content - Message content (JSON format, needs parsing)
 */
export interface FeishuMessageEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    token: string;
    create_time: string;
    token_type: string;
  };
  event: {
    sender: {
      sender_id: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
      sender_type: string;
    };
    receiver: {
      receiver_id: {
        open_id?: string;
        user_id?: string;
        union_id?: string;
      };
    };
    message_id: string;
    msg_type: string;
    content: string;
    create_time: string;
  };
}

/**
 * URL Verification Challenge
 * Event type used by Feishu to verify callback server legitimacy
 * 
 * Used for event verification in HTTP mode
 */
export interface VerificationChallenge {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    token: string;
    create_time: string;
  };
  event: {
    type: string;
    token: string;
    challenge: string;
  };
}

/**
 * Verification Response
 * Verification challenge answer returned to Feishu server
 */
export interface VerificationResponse {
  /** Verification challenge string */
  challenge: string;
}
