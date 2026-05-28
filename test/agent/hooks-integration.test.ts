import { Agent } from '../../src/agent';
import { HookManagerImpl, HOOKS } from '../../src/core/hooks';

describe('Agent Hook Integration', () => {
  let hookManager: HookManagerImpl;
  let testHookCalled: boolean;

  beforeEach(() => {
    hookManager = new HookManagerImpl();
    testHookCalled = false;
  });

  it('should execute with hooks', async () => {
    // Register test hook
    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'test-before-execute',
      name: 'Test Before Execute',
      priority: 50,
      handler: (context: any) => {
        testHookCalled = true;
        context.testField = 'test-value';
      }
    });

    // Create agent with mock LLM
    // Note: We can't directly inject mock LLM, so we'll test with a valid provider
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      hookManager,
      enableMemory: false
    });

    // Execute will try to call LLM, so we expect it might fail
    // But the hook should still be called
    try {
      await agent.execute('test task', 'test-user');
    } catch (error) {
      // Expected to fail due to invalid API key
    }

    // Verify hook was called
    expect(testHookCalled).toBe(true);
  });

  it('should execute beforeLLMCall hook', async () => {
    const executionOrder: string[] = [];

    hookManager.register(HOOKS.BEFORE_LLM_CALL, {
      id: 'test-before-llm',
      name: 'Test Before LLM',
      priority: 50,
      handler: () => { executionOrder.push('beforeLLMCall'); }
    });

    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      hookManager,
      enableMemory: false
    });

    try {
      await agent.execute('test task');
    } catch (error) {
      // Expected to fail due to invalid API key
    }

    // Verify beforeLLMCall hook was called
    expect(executionOrder).toEqual(['beforeLLMCall']);
  });

  it('should provide getHookManager method', () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      hookManager,
      enableMemory: false
    });

    const retrievedHookManager = agent.getHookManager();
    expect(retrievedHookManager).toBe(hookManager);
  });

  it('should create own HookManager if not provided', () => {
    const agent = new Agent({
      provider: 'openai',
      apiKey: 'test-key',
      enableMemory: false
    });

    const retrievedHookManager = agent.getHookManager();
    expect(retrievedHookManager).toBeDefined();
    expect(retrievedHookManager).toBeInstanceOf(HookManagerImpl);
  });
});
