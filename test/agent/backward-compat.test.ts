import { Agent } from '../../src/agent';

describe('Agent Backward Compatibility', () => {
  it('should work with enableMemory flag', async () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      enableMemory: true,
      memoryDbPath: './test-agent-memory.db'
    });

    // Verify agent was created successfully
    expect(agent).toBeDefined();
    expect(agent.getHookManager()).toBeDefined();

    // Clean up test database
    const fs = require('fs');
    try {
      fs.unlinkSync('./test-agent-memory.db');
      fs.unlinkSync('./test-agent-memory.db-shm');
      fs.unlinkSync('./test-agent-memory.db-wal');
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  it('should work without memory', async () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      enableMemory: false
    });

    expect(agent).toBeDefined();
    expect(agent.getHookManager()).toBeDefined();
  });

  it('should work with minimal config', async () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key'
    });

    expect(agent).toBeDefined();
  });

  it('should support custom systemPrompt', async () => {
    const customPrompt = 'You are a custom assistant.';

    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      systemPrompt: customPrompt
    });

    expect(agent).toBeDefined();
  });

  it('should support featurePrompts', async () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      featurePrompts: ['Focus on code quality', 'Use TypeScript']
    });

    expect(agent).toBeDefined();
  });
});
