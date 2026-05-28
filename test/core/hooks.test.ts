import { HookManagerImpl, HOOKS } from '../../src/core/hooks.js';
import type {
    BeforeExecuteContext,
    AfterStableContextContext,
    AfterDynamicContextContext,
    BeforeLLMCallContext,
    AfterLLMCallContext,
    BeforeToolCallContext,
    AfterToolCallContext,
    AfterExecuteContext,
    OnErrorContext
} from '../../src/core/hooks.js';

describe('HookManager', () => {
    let hookManager: HookManagerImpl;

    beforeEach(() => {
        hookManager = new HookManagerImpl();
    });

    // ========================================================================
    // Priority-Based Execution
    // ========================================================================

    describe('Priority-Based Execution', () => {
        it('should execute hooks in priority order (ascending)', async () => {
            const executionOrder: string[] = [];

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'hook-1',
                name: 'Hook 1',
                priority: 20,
                handler: () => { executionOrder.push('hook-1'); }
            });

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'hook-2',
                name: 'Hook 2',
                priority: 10,
                handler: () => { executionOrder.push('hook-2'); }
            });

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'hook-3',
                name: 'Hook 3',
                priority: 30,
                handler: () => { executionOrder.push('hook-3'); }
            });

            await hookManager.executeAsync(HOOKS.BEFORE_EXECUTE, {} as BeforeExecuteContext);

            expect(executionOrder).toEqual(['hook-2', 'hook-1', 'hook-3']);  // Priority 10, 20, 30
        });

        it('should maintain priority order after multiple registrations', async () => {
            const executionOrder: string[] = [];

            // First registration
            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'hook-a',
                name: 'Hook A',
                priority: 50,
                handler: () => { executionOrder.push('hook-a'); }
            });

            // Second registration (lower priority)
            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'hook-b',
                name: 'Hook B',
                priority: 10,
                handler: () => { executionOrder.push('hook-b'); }
            });

            // Third registration (middle priority)
            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'hook-c',
                name: 'Hook C',
                priority: 30,
                handler: () => { executionOrder.push('hook-c'); }
            });

            await hookManager.executeAsync(HOOKS.AFTER_EXECUTE, {} as AfterExecuteContext);

            expect(executionOrder).toEqual(['hook-b', 'hook-c', 'hook-a']);  // 10, 30, 50
        });
    });

    // ========================================================================
    // Context Modification
    // ========================================================================

    describe('Context Modification', () => {
        it('should allow hooks to modify context (synchronous)', () => {
            hookManager.register(HOOKS.AFTER_STABLE_CONTEXT, {
                id: 'modify-hook',
                name: 'Modify Context',
                priority: 10,
                handler: (context: any) => {
                    context.value = 'modified';
                    context.tokenCount = 1000;
                }
            });

            const context: any = { value: 'original', tokenCount: 0 };
            hookManager.execute(HOOKS.AFTER_STABLE_CONTEXT, context as any);

            expect(context.value).toBe('modified');
            expect(context.tokenCount).toBe(1000);
        });

        it('should allow hooks to modify context (asynchronous)', async () => {
            hookManager.register(HOOKS.AFTER_DYNAMIC_CONTEXT, {
                id: 'modify-hook-async',
                name: 'Modify Context Async',
                priority: 10,
                handler: async (context: any) => {
                    context.value = 'async-modified';
                    context.extra = 'added';
                }
            });

            const context: any = { value: 'original' };
            await hookManager.executeAsync(HOOKS.AFTER_DYNAMIC_CONTEXT, context);

            expect(context.value).toBe('async-modified');
            expect(context.extra).toBe('added');
        });

        it('should allow multiple hooks to modify context sequentially', async () => {
            hookManager.register(HOOKS.AFTER_STABLE_CONTEXT, {
                id: 'first-modifier',
                name: 'First Modifier',
                priority: 10,
                handler: (context: any) => {
                    context.value = 'first';
                }
            });

            hookManager.register(HOOKS.AFTER_STABLE_CONTEXT, {
                id: 'second-modifier',
                name: 'Second Modifier',
                priority: 20,
                handler: (context: any) => {
                    context.value = 'second';  // Overwrites first
                }
            });

            const context: any = { value: 'original' };
            await hookManager.executeAsync(HOOKS.AFTER_STABLE_CONTEXT, context);

            expect(context.value).toBe('second');  // Last modifier wins
        });
    });

    // ========================================================================
    // Error Isolation
    // ========================================================================

    describe('Error Isolation', () => {
        it('should isolate errors in hooks (synchronous)', () => {
            const executionOrder: string[] = [];

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'error-hook',
                name: 'Error Hook',
                priority: 10,
                handler: () => { throw new Error('Hook error'); }
            });

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'success-hook',
                name: 'Success Hook',
                priority: 20,
                handler: () => { executionOrder.push('success'); }
            });

            // Should not throw, should continue executing
            expect(() => {
                hookManager.execute(HOOKS.BEFORE_EXECUTE, {} as BeforeExecuteContext);
            }).not.toThrow();

            // Success hook should still run
            expect(executionOrder).toEqual(['success']);
        });

        it('should isolate errors in hooks (asynchronous)', async () => {
            const executionOrder: string[] = [];

            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'error-hook-async',
                name: 'Error Hook Async',
                priority: 10,
                handler: async () => { throw new Error('Async hook error'); }
            });

            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'success-hook-async',
                name: 'Success Hook Async',
                priority: 20,
                handler: async () => { executionOrder.push('async-success'); }
            });

            await hookManager.executeAsync(HOOKS.AFTER_EXECUTE, {} as AfterExecuteContext);

            // Success hook should still run
            expect(executionOrder).toEqual(['async-success']);
        });

        it('should continue executing after error in middle of chain', async () => {
            const executionOrder: string[] = [];

            hookManager.register(HOOKS.BEFORE_LLM_CALL, {
                id: 'first-hook',
                name: 'First Hook',
                priority: 10,
                handler: () => { executionOrder.push('first'); }
            });

            hookManager.register(HOOKS.BEFORE_LLM_CALL, {
                id: 'error-hook-middle',
                name: 'Error Hook Middle',
                priority: 20,
                handler: () => { throw new Error('Middle error'); }
            });

            hookManager.register(HOOKS.BEFORE_LLM_CALL, {
                id: 'last-hook',
                name: 'Last Hook',
                priority: 30,
                handler: () => { executionOrder.push('last'); }
            });

            await hookManager.executeAsync(HOOKS.BEFORE_LLM_CALL, {} as BeforeLLMCallContext);

            // First and last hooks should run, middle hook error is isolated
            expect(executionOrder).toEqual(['first', 'last']);
        });
    });

    // ========================================================================
    // Hook Registration
    // ========================================================================

    describe('Hook Registration', () => {
        it('should register hook successfully', () => {
            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'test-hook',
                name: 'Test Hook',
                priority: 50,
                handler: () => {}
            });

            expect(hookManager.hasHandlers(HOOKS.BEFORE_EXECUTE)).toBe(true);
        });

        it('should unregister hook successfully', () => {
            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'test-hook',
                name: 'Test Hook',
                priority: 50,
                handler: () => {}
            });

            expect(hookManager.hasHandlers(HOOKS.BEFORE_EXECUTE)).toBe(true);

            const result = hookManager.unregister(HOOKS.BEFORE_EXECUTE, 'test-hook');

            expect(result).toBe(true);
            expect(hookManager.hasHandlers(HOOKS.BEFORE_EXECUTE)).toBe(false);
        });

        it('should return false when unregistering non-existent hook', () => {
            const result = hookManager.unregister(HOOKS.BEFORE_EXECUTE, 'non-existent');

            expect(result).toBe(false);
        });

        it('should get all registered handlers', () => {
            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'hook-1',
                name: 'Hook 1',
                priority: 10,
                handler: () => {}
            });

            hookManager.register(HOOKS.AFTER_EXECUTE, {
                id: 'hook-2',
                name: 'Hook 2',
                priority: 20,
                handler: () => {}
            });

            const handlers = hookManager.getHandlers(HOOKS.AFTER_EXECUTE);

            expect(handlers.length).toBe(2);
            expect(handlers[0].id).toBe('hook-1');  // Sorted by priority
            expect(handlers[1].id).toBe('hook-2');
        });

        it('should return empty array for hook with no handlers', () => {
            const handlers = hookManager.getHandlers(HOOKS.ON_ERROR);

            expect(handlers).toEqual([]);
        });

        it('should report hasHandlers correctly', () => {
            expect(hookManager.hasHandlers(HOOKS.BEFORE_EXECUTE)).toBe(false);

            hookManager.register(HOOKS.BEFORE_EXECUTE, {
                id: 'test-hook',
                name: 'Test Hook',
                priority: 50,
                handler: () => {}
            });

            expect(hookManager.hasHandlers(HOOKS.BEFORE_EXECUTE)).toBe(true);
        });
    });

    // ========================================================================
    // Hook Execution
    // ========================================================================

    describe('Hook Execution', () => {
        it('should execute synchronous hooks', () => {
            let executed = false;

            hookManager.register(HOOKS.AFTER_TOOL_CALL, {
                id: 'sync-hook',
                name: 'Sync Hook',
                priority: 10,
                handler: () => { executed = true; }
            });

            hookManager.execute(HOOKS.AFTER_TOOL_CALL, {} as AfterToolCallContext);

            expect(executed).toBe(true);
        });

        it('should execute asynchronous hooks', async () => {
            let executed = false;

            hookManager.register(HOOKS.BEFORE_LLM_CALL, {
                id: 'async-hook',
                name: 'Async Hook',
                priority: 10,
                handler: async () => {
                    await new Promise(resolve => setTimeout(resolve, 10));
                    executed = true;
                }
            });

            await hookManager.executeAsync(HOOKS.BEFORE_LLM_CALL, {} as BeforeLLMCallContext);

            expect(executed).toBe(true);
        });

        it('should do nothing when no hooks registered', () => {
            expect(() => {
                hookManager.execute(HOOKS.ON_ERROR, {} as OnErrorContext);
            }).not.toThrow();
        });

        it('should do nothing when no hooks registered (async)', async () => {
            await expect(async () => {
                await hookManager.executeAsync(HOOKS.ON_ERROR, {} as OnErrorContext);
            }).resolves.not.toThrow();
        });
    });

    // ========================================================================
    // All Hook Points
    // ========================================================================

    describe('All Hook Points', () => {
        it('should support all 9 hook points', () => {
            const hookNames = Object.values(HOOKS);

            hookNames.forEach(hookName => {
                hookManager.register(hookName, {
                    id: `test-${hookName}`,
                    name: `Test ${hookName}`,
                    priority: 50,
                    handler: () => {}
                });

                expect(hookManager.hasHandlers(hookName)).toBe(true);
            });
        });
    });
});
