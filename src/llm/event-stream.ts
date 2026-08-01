/**
 * LLM Layer — Event Stream Implementation
 *
 * A concrete EventStream backed by an async generator of StreamEvents.
 * Aggregates events into a complete AssistantMessage.
 */

import type { AssistantMessage, EventStream, StreamEvent } from './types';

/**
 * Create an EventStream from an async iterable of StreamEvents.
 */
export function createEventStream(
  source: AsyncIterable<StreamEvent>,
): EventStream {
  const iterator = source[Symbol.asyncIterator]();

  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },

    async result(): Promise<AssistantMessage> {
      let lastMessage: AssistantMessage | undefined;
      for await (const event of source) {
        if (event.type === 'done') return event.message;
        if (event.type === 'error') {
          const err = new Error(event.error);
          if (event.message) {
            (err as unknown as { assistantMessage?: AssistantMessage }).assistantMessage = event.message;
          }
          throw err;
        }
        lastMessage = event.partial;
      }
      if (!lastMessage) {
        throw new Error('Stream ended without producing a message');
      }
      return lastMessage;
    },

    async forEach(cb: (event: StreamEvent) => void): Promise<AssistantMessage> {
      let lastMessage: AssistantMessage | undefined;
      for await (const event of source) {
        cb(event);
        if (event.type === 'done') return event.message;
        if (event.type === 'error') {
          const err = new Error(event.error);
          if (event.message) {
            (err as unknown as { assistantMessage?: AssistantMessage }).assistantMessage = event.message;
          }
          throw err;
        }
        lastMessage = event.partial;
      }
      if (!lastMessage) {
        throw new Error('Stream ended without producing a message');
      }
      return lastMessage;
    },
  };
}
