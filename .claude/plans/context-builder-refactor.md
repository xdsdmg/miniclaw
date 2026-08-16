# Miniclaw 上下文机制重构：Go 式 Context 贯穿运行时

## Context（为什么做）

现状 `src/agent.ts` 用两处**提前物化字符串**的方式拼系统提示词，很别扭：

1. `buildStableContext()`（~L328）：把 `systemPrompt + featurePrompts + toolDescriptions` 提前合并成一条 system 字符串。
2. `runLoop()`（~L391-L413）：用 `` `${systemPrompt}\n\n${dynamicContext}` `` 模板字符串拼接，再**新建一个** `ContextBuilder` 构建初始消息并拆成 prefix/history。

Hook（`afterStableContext` / `afterDynamicContext`）只能对裸字符串 `+=` 追加，hook 增强结果还要经实例字段 `enhancedStableContext` / `enhancedDynamicContext` 中转（单次使用、有并发竞态）。

**目标**：仿照 **Go 的 `context.Context`**——在执行过程（hook、runLoop）之间**传递一个可变 Context 对象**，各阶段读/改它，**最终调用 LLM 时才把 Context 组装成 `ChatMessage[]`**。

**已确认的决策**：
- 载体是纯数据接口 **`Context`**（Go 的 ctx），**不加** values 值袋，只做固定字段。
- **基于当前 WIP 修正前进**（保留 WIP 里的 `Context` 接口与「hook 拿 Context」方向）。

## 设计对账（Go 语义）

| Go | Miniclaw |
|---|---|
| 入口创建 ctx，贯穿所有函数 | `executeTaskInternal` 每任务创建，穿 hooks → runLoop |
| 中间层读写 ctx | hook 直接改 Context 字段（同一对象引用） |
| `context.WithValue` | 暂不实现（已决定不加值袋） |
| 不可变 / `WithValue` 返回子 ctx | **不采用**——HookManager 契约是就地修改同一对象，Context 为**可变**对象 |
| `WithCancel` / deadline | 暂不需要（后续可加 abort 信号） |

**关键点**：Go 的 ctx 是 per-request。WIP 把 Context 放实例字段 `this.context`（agent.ts:171）是错的——Agent 是共享单例（server.ts 一个实例服务多请求），并发会互相污染。改为**每任务创建 ctx 往下传**，顺带消除 `enhancedStableContext`/`enhancedDynamicContext` 实例字段的竞态。

## 目标 Context 形状（src/prompt.ts）

```ts
/** Go 式 ctx：贯穿执行过程的可变载体 */
export interface Context {
  /** Agent 身份/行为规则（任务开始时由 Agent 配置注入） */
  systemPrompt?: string;
  /** 功能级指令 */
  featurePrompts: string[];
  /** 工具描述 */
  toolDescriptions: string[];
  /** afterStableContext hook 追加的稳定段（如会话历史） */
  stableSections: string[];
  /** afterDynamicContext hook 追加的动态段（如 FTS5 结果 / skills） */
  dynamicSections: string[];
  /** 对话消息，runLoop 累积（替代 runLoop 内部 history 数组） */
  history: ChatMessage[];
}
```

**ContextBuilder 重新定位**：从「一次性 builder」变成**最终组装器**——接收 `Context`，只在 LLM 调用时 `build()` 出 `ChatMessage[]`：

```ts
export class ContextBuilder {
  constructor(private context: Context) {}
  /** [system?, ...history] —— system 由 systemPrompt+featurePrompts+toolDescriptions+stableSections+dynamicSections 用 \n\n 连接 */
  build(): ChatMessage[];
}
```

`ContextConfig`（与 Context 重复）删除，ContextBuilder 构造函数改为接收 `Context`。`ChatMessage` / `DEFAULT_SYSTEM_PROMPT` / `extractToolDescriptions` 不变。

## 涉及文件

- `src/prompt.ts` — 精修 `Context` 接口 + ContextBuilder 改为组装器 + 删 `ContextConfig`
- `src/core/hooks.ts` — hook 状态 `context: Context`（WIP 已改，补齐 doc + 清理 `ContextConfig` import）
- `src/memory/hooks.ts` — `onAfterStableContext`/`onAfterDynamicContext` 改为往 `ctx.stableSections` / `ctx.dynamicSections` `push`
- `src/agent.ts` — 删 `this.context`/`buildStableContext`/`buildDynamicContext`/`enhancedStableContext`/`enhancedDynamicContext`；per-task ctx 贯穿
- `test/memory/hooks.test.ts` — hook state 的 `context` 改为 Context 对象，断言改为 `stableSections`/`dynamicSections`

`src/llm/`、`src/tools-schema.ts`、`src/cli.ts`、`src/server.ts` 不改。

## 阶段 0 — 修复编译基线（保留 tmp save 全部改动，不回退）

当前 HEAD（`8a7b0eb tmp save`）**不能编译**，但它含重要改动，**全部保留、不做 `git checkout` 回退**：
- `src/prompt.ts` 的 `Context` 接口（方向）
- `src/memory/hooks.ts` 构造器改动（2-4 参）
- 删除 `src/llm.ts`、`src/server.ts` 的 `enableMemory: true`

因为 tmp save 已把 hook 状态类型改为 `context: Context`，**不存在可回退的旧基线**——修编译的过程就是重构本身。按阶段 1→4 的顺序逐个文件改，每步跑 `npx tsc --noEmit` 看进度。

第 0 步（纯损坏修复）：**修 [agent.ts:1-15](src/agent.ts#L1) 损坏的注释头**——第 1 行丢 `/**`、编号缩进错乱，替换为干净版（`/**` + `Miniclaw Agent Core` 标题 + 正确缩进）。语法恢复后 `tsc` 会露出真实错误：agent.ts 的 context 代码块 + `memory/hooks.ts` 的 5× TS2322。

## 阶段 1 — prompt.ts：Context 载体 + 组装器

- 精修 `Context` 接口（如上）；`stableSections`/`dynamicSections`/`history` 为必填数组（创建时给空数组）。
- `ContextBuilder` 改为持有 `Context`、`build()` 组装；删 `ContextConfig`。

## 阶段 2 — core/hooks.ts：hook 状态类型

- `AfterStableContextContext.context` / `AfterDynamicContextContext.context` 已是 `Context`（WIP 已改），更新接口 doc comment（"通过 `context.stableSections.push(...)` / `context.dynamicSections.push(...)` 追加"）。
- 清理顶部 `import { Context, ContextConfig }` → 只留 `Context`。

## 阶段 3 — memory/hooks.ts：改为 push 段落

- `onAfterStableContext`：拼一段 `'## Recent Conversation\n\n' + 消息`，`context.context.stableSections.push(section)`（去掉行首 `'\n'`）。
- `onAfterDynamicContext`：FTS5 → `context.context.dynamicSections.push(...)`；skills → `context.context.dynamicSections.push(formattedSkills)`。

## 阶段 4 — agent.ts：per-task ctx 贯穿

- **删**：`this.context` 字段及构造器初始化、`buildStableContext`、`buildDynamicContext`、`enhancedStableContext`、`enhancedDynamicContext`。
- **新增**：
  ```ts
  private createBaseContext(): Context {
    return {
      systemPrompt: this.systemPrompt,
      featurePrompts: this.featurePrompts,
      toolDescriptions: extractToolDescriptions(tools),
      stableSections: [],
      dynamicSections: [],
      history: [],
    };
  }
  ```
- `executeTaskInternal`：
  - `const ctx = this.createBaseContext();`
  - `afterStableContext` state：`{ taskId, userId, task, context: ctx, contextType: 'stable', tokenCount: this.estimateTokens(new ContextBuilder(ctx).build()), cached: true }`
  - `afterDynamicContext` state：同理，`context: ctx`。
  - **不再需要回读** `stableContextState.context`——hook 就地修改同一个 ctx 对象引用。
  - `const result = await this.runLoop(task, onProgress, execContext, ctx);`
- `runLoop` 追加第 4 个参数 `ctx?: Context`：
  ```ts
  const context = ctx ?? this.createBaseContext();
  context.history.push({ role: 'user', content: input });   // 种子用户消息
  ```
  删掉 L391-417 的拼接/prefix/history 拆分。循环内 `const allMessages = new ContextBuilder(context).build();`，三处 `history.push` 改为 `context.history.push`。

## 阶段 5 — test/memory/hooks.test.ts

- 构造的 hook state（约 6 处）`context: 'string'` → `context: { systemPrompt: 'Initial context\n', featurePrompts: [], toolDescriptions: [], stableSections: [], dynamicSections: [], history: [] }`。
- 断言 `context.context` 改为：
  - `toContain('## Recent Conversation')` / `'user: Hello'` → `context.context.stableSections.join('')`
  - 无历史时不修改 → `context.context.stableSections` 为空
  - last-5 行数统计 → 对 `stableSections` 内的段落行过滤计数
- `test/core/hooks.test.ts`、`test/agent/hook-order.test.ts` 不读 context 字段，无需改。

## 行为差异说明

- 各 prompt 段统一 `\n\n` 连接，相对旧 hook 手写 `\n`，段间可能多一个空行（纯格式归一）。
- `afterDynamicContext` 的 `tokenCount` 反映「base+stable」而非旧「动态内容本身」（更准，信息性字段）。
- 直接调用 `runLoop`（不经 executeTaskInternal）：fallback ctx 带 featurePrompts+toolDescriptions（旧行为只有裸 systemPrompt）——改进，对主路径无影响。
- **并发安全提升**：ctx per-task，无共享实例字段竞态。

## 验证

1. `npx tsc --noEmit` — 类型检查全绿。
2. `npx jest test/memory/hooks.test.ts test/agent/hook-order.test.ts test/core/hooks.test.ts` — 定向。
3. `npm test` — 全量 jest。
4. `npm run build` — 编译通过。
5. 手动冒烟（可选，需 API key）：`npx ts-node src/cli.ts "..."`，确认 hook 增强内容出现在最终 system 消息中、工具调用正常。
