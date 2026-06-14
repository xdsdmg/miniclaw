/**
 * Context Compression Tests
 */

import { ContextCompressor, ChatMessage } from '../../src/learning/compression.js';
import { SmartSummarizer } from '../../src/learning/summarizer.js';

describe('ContextCompressor', () => {
  let compressor: ContextCompressor;
  let summarizer: SmartSummarizer;

  beforeEach(() => {
    summarizer = new SmartSummarizer();
    compressor = new ContextCompressor(summarizer);
  });

  describe('compress', () => {
    it('should compress long context', async () => {
      const longContext = `
## System Message
System instructions go here...

## User Message 1
First user message asking for help with deployment...

## Assistant Message 1
Assistant responds with detailed instructions...

## User Message 2
Second user message...

## Assistant Message 2
Another response...

## Tool Result
Bash output:
Building application...
Running tests...
All tests passed...

## User Message 3
Current task: Deploy to production

## Assistant Message 3
Latest response...
      `.trim();

      const result = await compressor.compress(longContext, {
        maxTokens: 500,
        preserveSections: {
          currentTask: true,
          lastAssistantResponses: 1,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      expect(result.context).toBeDefined();
      expect(result.originalTokens).toBeGreaterThan(result.compressedTokens);
      expect(result.compressedTokens).toBeLessThanOrEqual(500 * 1.5); // Allow some margin
    });

    it('should preserve current task when configured', async () => {
      const context = `
## User Message
Current task: Fix the authentication bug

## Assistant Message
Working on authentication fix...

## Old Context
Previous conversation history...
      `.trim();

      const result = await compressor.compress(context, {
        maxTokens: 200,
        preserveSections: {
          currentTask: true,
          lastAssistantResponses: 1,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      expect(result.context).toContain('authentication');
    });

    it('should preserve last N assistant responses', async () => {
      const context = `
## Assistant Message 1
First response

## Assistant Message 2
Second response

## Assistant Message 3
Third response

## Old Assistant Message
Old response
      `.trim();

      const result = await compressor.compress(context, {
        maxTokens: 200,
        preserveSections: {
          currentTask: false,
          lastAssistantResponses: 2,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      // Should preserve last 2 assistant messages
      expect(result.context).toContain('Third response');
      expect(result.context).toContain('Second response');
    });

    it('should handle empty context', async () => {
      const result = await compressor.compress('');
      expect(result.context).toBe('');
      expect(result.originalTokens).toBe(0);
      expect(result.compressedTokens).toBe(0);
    });

    it('should track removed and summarized sections', async () => {
      const context = `
## Section 1
Important content to preserve

## Section 2
Content to summarize

## Section 3
Content to remove
      `.trim();

      const result = await compressor.compress(context, {
        maxTokens: 100,
        preserveSections: {
          currentTask: false,
          lastAssistantResponses: 0,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.3,
      });

      expect(result.removedSections).toBeDefined();
      expect(Array.isArray(result.removedSections)).toBe(true);
      expect(result.summarizedSections).toBeDefined();
      expect(Array.isArray(result.summarizedSections)).toBe(true);
    });
  });

  describe('compressMessages', () => {
    it('should preserve last user message', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'First request' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Current task: Deploy app' },
        { role: 'assistant', content: 'Current response' },
      ];

      const compressed = await compressor.compressMessages(messages, {
        maxTokens: 500,
        preserveSections: {
          currentTask: true,
          lastAssistantResponses: 1,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      expect(compressed.some(m => m.content.includes('Current task'))).toBe(true);
    });

    it('should preserve system messages', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System instructions' },
        { role: 'user', content: 'User request' },
        { role: 'assistant', content: 'Response' },
      ];

      const compressed = await compressor.compressMessages(messages);

      expect(compressed.some(m => m.role === 'system')).toBe(true);
    });

    it('should preserve last N assistant responses', async () => {
      const messages: ChatMessage[] = [
        { role: 'assistant', content: 'Old response 1' },
        { role: 'assistant', content: 'Old response 2' },
        { role: 'assistant', content: 'Recent response 1' },
        { role: 'assistant', content: 'Recent response 2' },
      ];

      const compressed = await compressor.compressMessages(messages, {
        maxTokens: 500,
        preserveSections: {
          currentTask: false,
          lastAssistantResponses: 2,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      const assistantCount = compressed.filter(m => m.role === 'assistant').length;
      expect(assistantCount).toBeLessThanOrEqual(2);
    });
  });

  describe('needsCompression', () => {
    it('should return true for long contexts', () => {
      const longContext = 'a'.repeat(10000);
      const needsCompress = compressor.needsCompression(longContext, {
        maxTokens: 1000,
        preserveSections: {
          currentTask: true,
          lastAssistantResponses: 2,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      expect(needsCompress).toBe(true);
    });

    it('should return false for short contexts', () => {
      const shortContext = 'Short context';
      const needsCompress = compressor.needsCompression(shortContext, {
        maxTokens: 10000,
        preserveSections: {
          currentTask: true,
          lastAssistantResponses: 2,
          minSkillSuccessRate: 0.7,
          toolResults: false,
        },
        compressionRatio: 0.5,
      });

      expect(needsCompress).toBe(false);
    });

    it('should use default strategy when not provided', () => {
      const result = compressor.needsCompression('test');
      expect(typeof result).toBe('boolean');
    });
  });
});

describe('SmartSummarizer', () => {
  let summarizer: SmartSummarizer;

  beforeEach(() => {
    summarizer = new SmartSummarizer();
  });

  describe('summarizeHistory', () => {
    it('should summarize empty messages', async () => {
      const summary = await summarizer.summarizeHistory([]);
      expect(summary).toBe('');
    });

    it('should extract user intents', async () => {
      const messages = [
        { role: 'user' as const, content: 'Please help me deploy my application to production' },
        { role: 'assistant' as const, content: 'I will help you deploy' },
      ];

      const summary = await summarizer.summarizeHistory(messages);
      expect(summary).toBeDefined();
      expect(summary.length).toBeGreaterThan(0);
    });

    it('should extract assistant actions', async () => {
      const messages = [
        { role: 'user' as const, content: 'Fix the bug' },
        { role: 'assistant' as const, content: 'I fixed the authentication bug in the login module' },
      ];

      const summary = await summarizer.summarizeHistory(messages);
      expect(summary).toBeDefined();
    });

    it('should handle tool messages', async () => {
      const messages = [
        { role: 'tool' as const, content: 'Build successful', toolName: 'bash' },
      ];

      const summary = await summarizer.summarizeHistory(messages);
      expect(summary).toBeDefined();
    });
  });

  describe('summarizeToolResult', () => {
    it('should summarize bash results', async () => {
      const result = `
Building application...
Running tests...
All tests passed!
Build complete.
      `.trim();

      const summary = await summarizer.summarizeToolResult('bash', result);
      expect(summary).toBeDefined();
      expect(summary.length).toBeLessThan(result.length);
    });

    it('should summarize read results', async () => {
      const result = `
// File content
function test() {
  return true;
}
      `.trim();

      const summary = await summarizer.summarizeToolResult('read', result);
      expect(summary).toBeDefined();
    });

    it('should handle unknown tool types', async () => {
      const result = 'Some tool output';
      const summary = await summarizer.summarizeToolResult('unknown', result);
      expect(summary).toBeDefined();
    });
  });

  describe('summarizeGeneric', () => {
    it('should handle empty text', () => {
      const summary = summarizer.summarizeGeneric('');
      expect(summary).toBe('');
    });

    it('should return short text as-is', () => {
      const shortText = 'Short message';
      const summary = summarizer.summarizeGeneric(shortText);
      expect(summary).toBe(shortText);
    });

    it('should truncate long text', () => {
      const longText = 'a'.repeat(300);
      const summary = summarizer.summarizeGeneric(longText, {
        maxLength: 100,
        includeKeyPoints: true,
        preserveEntities: true,
        tone: 'concise',
      });
      expect(summary.length).toBeLessThan(300);
      expect(summary).toContain('...');
    });

    it('should extract first sentence', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const summary = summarizer.summarizeGeneric(text);
      expect(summary).toContain('First sentence');
    });
  });

  describe('extractKeyPoints', () => {
    it('should extract bullet points', () => {
      const text = `
- First important point
- Second important point
- Third important point
      `.trim();

      const points = summarizer.extractKeyPoints(text);
      expect(points).toHaveLength(3);
      expect(points[0]).toContain('First important point');
    });

    it('should extract numbered points', () => {
      const text = `
1. First step
2. Second step
3. Third step
      `.trim();

      const points = summarizer.extractKeyPoints(text);
      expect(points.length).toBeGreaterThanOrEqual(1);
    });

    it('should look for key indicators', () => {
      const text = 'This is important. The critical step is testing. This must be done.';
      const points = summarizer.extractKeyPoints(text);
      expect(points.length).toBeGreaterThan(0);
    });

    it('should limit to 5 key points', () => {
      const text = `
- Point 1
- Point 2
- Point 3
- Point 4
- Point 5
- Point 6
- Point 7
      `.trim();

      const points = summarizer.extractKeyPoints(text);
      expect(points.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array when no points found', () => {
      const text = 'Just a regular sentence without any special formatting.';
      const points = summarizer.extractKeyPoints(text);
      expect(points).toHaveLength(0);
    });
  });

  describe('summarizeBulleted', () => {
    it('should generate bulleted summary', () => {
      const text = `
- First point
- Second point
- Third point
      `.trim();

      const summary = summarizer.summarizeBulleted(text);
      expect(summary).toContain('•');
      expect(summary).toContain('First point');
    });

    it('should fallback to generic summary when no bullets', () => {
      const text = 'Regular text without bullets';
      const summary = summarizer.summarizeBulleted(text);
      expect(summary).toBeDefined();
    });
  });
});
