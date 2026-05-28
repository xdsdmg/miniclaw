import { Agent } from '../../src/agent';
import { HookManagerImpl, HOOKS } from '../../src/core/hooks';

describe('Agent Hook Execution Order', () => {
  let hookManager: HookManagerImpl;
  let executionOrder: string[];

  beforeEach(() => {
    hookManager = new HookManagerImpl();
    executionOrder = [];

    // Register hooks at all key points
    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'test-before-execute',
      name: 'Test Before Execute',
      priority: 50,
      handler: () => { executionOrder.push('beforeExecute'); }
    });

    hookManager.register(HOOKS.AFTER_STABLE_CONTEXT, {
      id: 'test-after-stable',
      name: 'Test After Stable',
      priority: 50,
      handler: () => { executionOrder.push('afterStableContext'); }
    });

    hookManager.register(HOOKS.AFTER_DYNAMIC_CONTEXT, {
      id: 'test-after-dynamic',
      name: 'Test After Dynamic',
      priority: 50,
      handler: () => { executionOrder.push('afterDynamicContext'); }
    });

    hookManager.register(HOOKS.BEFORE_LLM_CALL, {
      id: 'test-before-llm',
      name: 'Test Before LLM',
      priority: 50,
      handler: () => { executionOrder.push('beforeLLMCall'); }
    });

    hookManager.register(HOOKS.AFTER_LLM_CALL, {
      id: 'test-after-llm',
      name: 'Test After LLM',
      priority: 50,
      handler: () => { executionOrder.push('afterLLMCall'); }
    });

    hookManager.register(HOOKS.AFTER_EXECUTE, {
      id: 'test-after-execute',
      name: 'Test After Execute',
      priority: 50,
      handler: () => { executionOrder.push('afterExecute'); }
    });
  });

  it('should execute hooks in correct order during normal execution', async () => {
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

    // Verify hooks executed in correct order (up to the point of failure)
    // The afterLLMCall and afterExecute won't run if LLM call fails
    expect(executionOrder).toEqual([
      'beforeExecute',
      'afterStableContext',
      'afterDynamicContext',
      'beforeLLMCall'
    ]);
  });

  it('should execute onError hook when execution fails', async () => {
    const errorHookCalled: boolean[] = [];

    hookManager.register(HOOKS.ON_ERROR, {
      id: 'test-on-error',
      name: 'Test On Error',
      priority: 50,
      handler: () => { errorHookCalled.push(true); }
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
      // Expected to fail
    }

    // Verify onError hook was called
    expect(errorHookCalled.length).toBeGreaterThan(0);
  });

  it('should respect hook priority order', async () => {
    const priorityOrder: number[] = [];

    // Register hooks with different priorities
    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'priority-high',
      name: 'High Priority',
      priority: 10,
      handler: () => { priorityOrder.push(10); }
    });

    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'priority-low',
      name: 'Low Priority',
      priority: 50,
      handler: () => { priorityOrder.push(50); }
    });

    hookManager.register(HOOKS.BEFORE_EXECUTE, {
      id: 'priority-medium',
      name: 'Medium Priority',
      priority: 30,
      handler: () => { priorityOrder.push(30); }
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
      // Expected to fail
    }

    // Verify hooks executed in priority order (10, 30, 50)
    expect(priorityOrder).toEqual([10, 30, 50]);
  });
});
