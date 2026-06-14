# Phase 7: Learning Loop and Skills System - Design Document

## 1. 概述

### 1.1 背景

Miniclaw 已完成 Phases 1-6 的开发，具备：
- 核心 Agent 执行能力
- 多 LLM Provider 支持
- 工具执行系统
- Memory Storage（持久化存储）
- Prompt Memory（提示词记忆）
- Hook Architecture（钩子架构）

当前系统虽然能够执行任务并保存历史记录，但无法从过去的执行中学习并复用成功的模式。Phase 7 旨在实现学习循环，使 Miniclaw 能够自动积累知识和技能。

### 1.2 设计目标

**主要目标**：
1. 自动从成功的任务执行中提取知识
2. 将提取的知识结构化存储为技能（Skills）
3. 在相似任务中加载和应用已学习的技能
4. 优化上下文大小以适应 Token 限制

**非目标**（Phase 7 范围外）：
- 用户手动创建技能
- 跨用户技能共享
- 复杂的技能编排
- 多模态学习

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **保守学习** | 只从高质量、成功的执行中学习 |
| **非阻塞** | 学习在后台异步进行，不影响任务执行 |
| **相关性优先** | 通过搜索和过滤确保技能相关性 |
| **质量过滤** | 使用成功率、置信度等指标过滤 |
| **可追溯** | 记录学习来源、使用统计 |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Miniclaw 系统架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              现有系统 (Phases 1-6)                      │   │
│  │                                                         │   │
│  │   Agent ──▶ HookManager ──▶ MemoryHooks               │   │
│  │                                  │                       │   │
│  │                                  ▼                       │   │
│  │                         MemoryStorage                   │   │
│  │                         SessionManager                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              │ MemoryHooks 集成点               │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Phase 7: 学习系统                           │   │
│  │                                                         │   │
│  │  ┌──────────────┐      ┌──────────────┐               │   │
│  │  │   Learning    │─────▶│  Knowledge    │               │   │
│  │  │   Triggers    │      │  Extractor    │               │   │
│  │  └──────┬───────┘      └──────┬───────┘               │   │
│  │         │                      │                        │   │
│  │         ▼                      ▼                        │   │
│  │  ┌──────────────┐      ┌──────────────┐               │   │
│  │  │   Learning    │◀─────│  Skill        │               │   │
│  │  │   Storage     │      │  Loader       │               │   │
│  │  └──────┬───────┘      └──────┬───────┘               │   │
│  │         │                      │                        │   │
│  │         ▼                      ▼                        │   │
│  │  ┌──────────────┐      ┌──────────────┐               │   │
│  │  │   Context     │      │  Skill        │               │   │
│  │  │   Compressor  │      │  Application  │               │   │
│  │  └──────────────┘      └──────────────┘               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              SQLite 数据库                               │   │
│  │  ┌────────────┐  ┌──────────────┐  ┌────────────┐     │   │
│  │  │Conversations│ │LearnedSkills │ │Interactions│     │   │
│  │  └────────────┘  └──────────────┘  └────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
执行阶段                学习阶段（异步）              应用阶段
────────                ──────────────              ─────────

[任务]                 [执行完成]                  [新任务]
  │                       │                           │
  ▼                       ▼                           ▼
Agent                 afterExecute钩子            加载相关技能
  │                       │                           │
  ▼                       ▼                           ▼
工具执行              评估学习条件               注入上下文
  │                       │                           │
  ▼                  ┌───┴───┐                       │
[结果]               │       │                       ▼
                   [是]    [否]                    Agent
                     │       │
                     ▼       ▔─┐
                提取知识        │
                     │          │
                     ▼          │
                存储技能        │
                     │          │
                     └──────────┘
```

---

## 3. 核心组件设计

### 3.1 LearningTriggers（学习触发器）

**职责**：评估对话是否应该被学习

**接口**：
```typescript
interface LearningContext {
  conversationId: string;
  userId: string;
  task: string;
  result: string;
  turnCount: number;        // 对话轮数
  toolCallCount: number;   // 工具调用次数
  hadErrors: boolean;       // 是否有错误
  recovered: boolean;       // 是否从错误中恢复
  duration: number;         // 执行时长(ms)
}

interface LearningTriggerResult {
  shouldLearn: boolean;
  reason: string;
  quality: 'high' | 'medium' | 'low';
  learningType: 'skill' | 'pattern' | 'fact';
}

class LearningTriggers {
  evaluate(context: LearningContext): LearningTriggerResult;
}
```

**评估矩阵**：

| 指标 | 高质量 | 中等质量 | 低质量 |
|------|--------|----------|--------|
| 轮数 | 1-3 | 4-6 | 7+ |
| 工具数 | 2-5 | 1 | 0 |
| 错误恢复 | 是 | - | 否 |
| 成功率 | 100% | - | <100% |

**评分规则**：
```
总分 = 轮数分 + 工具分 + 恢复分
- 轮数分: 1-3轮=3, 4-6轮=2, 7+轮=0
- 工具分: 2-5工具=3, 1工具=1, 0工具=0
- 恢复分: 有恢复=2, 无错误=1, 有错误未恢复=0

总分 ≥ 5: 高质量
总分 3-4: 中等质量
总分 < 3: 低质量（不学习）
```

### 3.2 KnowledgeExtractor（知识提取器）

**职责**：从成功的对话中提取结构化知识

**接口**：
```typescript
interface ExtractedKnowledge {
  type: 'skill' | 'pattern' | 'fact';
  title: string;
  description: string;
  taskPattern: string;      // 任务匹配模式
  toolSequence: ToolStep[]; // 工具执行序列
  outcome: string;          // 执行结果
  confidence: number;       // 置信度 (0-1)
  metadata: {
    learnedFrom: string;
    learnedAt: Date;
    userId: string;
  };
}

interface ToolStep {
  tool: string;
  argsTemplate: Record<string, string>;
  resultPattern?: string;
}

class KnowledgeExtractor {
  async extract(conversationId: string): Promise<ExtractedKnowledge[]>;
}
```

**提取类型**：

1. **Skill（技能）**：可复用的多步骤程序
   - 条件：2+ 工具组合，成功率 100%
   - 示例：部署流程（git push → kubectl apply → 验证）

2. **Pattern（模式）**：常见问题解决方法
   - 条件：重复出现的工具序列
   - 示例：文件分析流程

3. **Fact（事实）**：持久化信息
   - 条件：用户明确提供的偏好或配置
   - 示例：用户偏好 Python 代码风格

### 3.3 LearningStorage（学习存储）

**职责**：存储和管理学习的技能

**数据库 Schema**：
```sql
CREATE TABLE IF NOT EXISTS learned_skills (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'skill', 'pattern', 'fact'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_pattern TEXT NOT NULL,      -- 用于匹配
  tool_sequence TEXT NOT NULL,    -- JSON 格式
  outcome TEXT NOT NULL,
  user_id TEXT NOT NULL,
  learned_from TEXT NOT NULL,      -- conversation_id
  learned_at INTEGER NOT NULL,
  times_used INTEGER DEFAULT 0,
  last_used INTEGER,
  success_rate REAL DEFAULT 1.0,
  avg_duration INTEGER,
  FOREIGN KEY (learned_from) REFERENCES conversations(id)
);

-- FTS5 全文搜索索引
CREATE VIRTUAL TABLE IF NOT EXISTS learned_skills_fts USING fts5(
  title, description, outcome,
  content=learned_skills,
  content_rowid=rowid
);
```

**接口**：
```typescript
interface LearnedSkill {
  id: string;
  type: 'skill' | 'pattern' | 'fact';
  title: string;
  description: string;
  taskPattern: string;
  toolSequence: ToolStep[];
  outcome: string;
  metadata: {
    userId: string;
    learnedFrom: string;
    learnedAt: Date;
    timesUsed: number;
    lastUsed?: Date;
    successRate: number;
    avgDuration: number;
  };
}

class LearningStorage {
  saveSkill(skill: LearnedSkill): void;
  searchSkills(task: string, limit: number): LearnedSkill[];
  recordUsage(skillId: string, success: boolean): void;
  getUserSkills(userId: string): LearnedSkill[];
  deleteSkill(skillId: string): void;
}
```

### 3.4 SkillLoader（技能加载器）

**职责**：为当前任务加载相关技能

**接口**：
```typescript
interface Skill {
  id: string;
  type: 'skill' | 'pattern' | 'fact';
  title: string;
  description: string;
  toolSequence: ToolStep[];
  outcome: string;
  usageStats: {
    timesUsed: number;
    successRate: number;
    lastUsed?: Date;
  };
}

class SkillLoader {
  loadRelevantSkills(task: string, userId?: string, limit: number = 3): Skill[];
  formatSkillsForContext(skills: Skill[]): string;
}
```

**技能上下文格式**：
```
## Relevant Skills

### Skill: Deploy to Production
**Description**: Deploy application using git and kubectl
**Success Rate**: 95% (used 20 times)
**Steps**:
1. Run: git push origin main
2. Run: kubectl apply -f deployment.yaml  
3. Run: kubectl rollout status deployment/app
```

### 3.5 SkillApplication（技能应用器）

**职责**：应用学习的技能到当前任务

**接口**：
```typescript
class SkillApplication {
  applySkill(skill: Skill, task: string, mode: ApplicationMode): Promise<string>;
  matchTaskToSkill(task: string, skill: Skill): number;
}

type ApplicationMode = 'suggest' | 'template' | 'auto';
```

**应用模式**：

| 模式 | 说明 | 风险 | 适用场景 |
|------|------|------|----------|
| **suggest** | 添加到上下文，LLM 决定 | 低 | 默认模式 |
| **template** | 从模板生成代码 | 中 | 代码生成任务 |
| **auto** | 直接执行工具序列 | 高 | 高置信度常规任务 |

### 3.6 ContextCompressor（上下文压缩器）

**职责**：优化上下文大小

**接口**：
```typescript
interface CompressionStrategy {
  maxTokens: number;
  preserveSections: string[];
  compressionRatio: number;
}

class ContextCompressor {
  async compress(context: string, strategy: CompressionStrategy): Promise<string>;
  estimateTokens(text: string): number;
}
```

**压缩策略**：

```
保留（必须）:
  ✓ 当前任务
  ✓ 最近 2 轮对话
  ✓ 高成功率技能（>0.8）

总结（压缩）:
  ℹ 早期对话历史
  ℹ 工具执行结果（保留关键部分）

移除（丢弃）:
  ✗ 低成功率技能（<0.5）
  ✗ 重复信息
  ✗ 冗长输出（截断到 200 字符）
```

---

## 4. 集成设计

### 4.1 MemoryHooks 扩展

在 `src/memory/hooks.ts` 中添加学习组件：

```typescript
export class MemoryHooks {
  private learningTriggers?: LearningTriggers;
  private knowledgeExtractor?: KnowledgeExtractor;
  private learningStorage?: LearningStorage;
  private skillLoader?: SkillLoader;

  constructor(
    memoryManager: MemoryManager,
    sessionManager: SessionManager
  ) {
    // 初始化学习组件
    this.learningStorage = new LearningStorage(dbPath);
    this.learningTriggers = new LearningTriggers();
    this.knowledgeExtractor = new KnowledgeExtractor(llm, this.learningStorage);
    this.skillLoader = new SkillLoader(this.learningStorage);
  }

  // 完成 afterDynamicContext - 加载技能
  async onAfterDynamicContext(context: AfterDynamicContextContext): Promise<void> {
    // 现有搜索逻辑...

    // 加载相关技能
    const skills = this.skillLoader?.loadRelevantSkills(context.task, context.userId, 3);
    if (skills && skills.length > 0) {
      context.context += '\n## Relevant Skills\n\n';
      context.context += this.skillLoader?.formatSkillsForContext(skills) || '';
    }
  }

  // 完成 afterExecute - 学习循环
  async onAfterExecute(context: AfterExecuteContext): Promise<void> {
    // 评估学习条件
    const triggerResult = this.learningTriggers?.evaluate({
      conversationId: context.conversationId || '',
      userId: context.userId || '',
      task: context.task,
      result: context.result || '',
      turnCount: context.turnCount,
      toolCallCount: context.toolCallCount,
      hadErrors: !context.success,
      recovered: context.success,
      duration: context.duration
    });

    if (triggerResult?.shouldLearn) {
      // 提取知识
      const extracted = await this.knowledgeExtractor?.extract(context.conversationId || '');
      
      // 存储技能
      for (const knowledge of extracted || []) {
        this.learningStorage?.saveSkill({
          id: crypto.randomUUID(),
          type: knowledge.type,
          title: knowledge.title,
          description: knowledge.description,
          taskPattern: knowledge.taskPattern,
          toolSequence: knowledge.toolSequence,
          outcome: knowledge.outcome,
          metadata: {
            userId: knowledge.metadata.userId,
            learnedFrom: knowledge.metadata.learnedFrom,
            learnedAt: knowledge.metadata.learnedAt,
            timesUsed: 0,
            successRate: 1.0,
            avgDuration: context.duration
          }
        });
      }
    }
  }
}
```

### 4.2 Agent 配置扩展

在 `AgentConfig` 中添加学习配置：

```typescript
export interface AgentConfig {
  // 现有字段...
  
  // 学习配置
  enableLearning?: boolean;
  learningMinQuality?: 'high' | 'medium' | 'low';
  maxSkillsPerTask?: number;
  autoExecuteSkills?: boolean;
}
```

---

## 5. 实施计划

### 5.1 时间线

```
Week 1: 学习基础设施
├─ 创建 src/learning/ 目录
├─ 实现 LearningTriggers
├─ 实现 LearningStorage + 数据库迁移
└─ 单元测试

Week 2: 知识提取
├─ 实现 KnowledgeExtractor
├─ 添加 LLM 语义分析
├─ 实现置信度评分
└─ 单元测试

Week 3: 技能系统
├─ 实现 SkillLoader
├─ 实现 SkillApplication
├─ 添加技能匹配算法
└─ 单元测试

Week 4: 压缩与集成
├─ 实现 ContextCompressor
├─ 实现 SmartSummarizer
├─ 更新 MemoryHooks
├─ 更新 Agent 配置

Week 5: 测试与文档
├─ 集成测试
├─ 端到端测试
├─ 更新文档

Week 6: 优化与部署
├─ 性能优化
├─ Bug 修复
└─ 生产部署
```

### 5.2 文件结构

```
src/
├── learning/
│   ├── index.ts              # 导出所有学习模块
│   ├── triggers.ts            # LearningTriggers
│   ├── extractor.ts           # KnowledgeExtractor
│   ├── storage.ts             # LearningStorage
│   ├── skills.ts              # SkillLoader, SkillApplication
│   ├── compression.ts         # ContextCompressor
│   ├── summarizer.ts          # SmartSummarizer
│   └── __tests__/
│       ├── triggers.test.ts
│       ├── extractor.test.ts
│       ├── storage.test.ts
│       ├── skills.test.ts
│       └── integration.test.ts
├── memory/
│   └── hooks.ts               # 扩展以支持学习组件
├── agent.ts                    # 扩展 AgentConfig
└── core/
    └── hooks.ts               # 可能需要添加新钩子点
```

### 5.3 数据库迁移

创建迁移脚本 `src/memory/migrations/002_add_learning.sql`：

```sql
-- Phase 7: 学习技能表

CREATE TABLE IF NOT EXISTS learned_skills (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_pattern TEXT NOT NULL,
  tool_sequence TEXT NOT NULL,
  outcome TEXT NOT NULL,
  user_id TEXT NOT NULL,
  learned_from TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  times_used INTEGER DEFAULT 0,
  last_used INTEGER,
  success_rate REAL DEFAULT 1.0,
  avg_duration INTEGER,
  FOREIGN KEY (learned_from) REFERENCES conversations(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS learned_skills_fts USING fts5(
  title, description, outcome,
  content=learned_skills,
  content_rowid=rowid
);

CREATE INDEX IF NOT EXISTS idx_learned_skills_user ON learned_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_learned_skills_type ON learned_skills(type);
```

---

## 6. 风险评估

### 6.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 低质量技能污染系统 | 高 | 中 | 保守学习阈值、用户反馈循环、技能修剪 |
| 上下文膨胀导致超限 | 中 | 高 | 激进压缩、技能数量限制、质量过滤 |
| LLM 提取成本过高 | 中 | 中 | 批量提取、缓存结果、使用小模型 |
| 技能匹配不准确 | 高 | 中 | 多策略匹配、人工反馈、持续优化 |

### 6.2 运行风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 学习阻塞任务执行 | 高 | 完全异步执行、超时保护 |
| 数据库性能下降 | 中 | 索引优化、定期清理低质量技能 |
| 存储空间增长过快 | 低 | 设置上限、自动清理旧技能 |

---

## 7. 成功标准

### 7.1 功能要求

- [ ] 自动从成功对话中学习（成功率 >80% 触发学习）
- [ ] 存储三类知识：技能、模式、事实
- [ ] 为相似任务加载相关技能（FTS5 搜索）
- [ ] 压缩上下文以适应 Token 限制
- [ ] 追踪学习系统效果

### 7.2 质量指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 学习精确率 | >70% | 学到的技能中，相关技能占比 |
| 学习召回率 | >60% | 应该学习的技能中，实际学习的占比 |
| 压缩率 | 30-50% | 压缩后大小 / 原始大小 |
| 性能开销 | <100ms | 每次对话的学习耗时 |

### 7.3 验收测试

```typescript
// 测试场景1: 学习循环
describe('Learning Loop', () => {
  test('should learn from successful multi-tool task', async () => {
    // 执行一个多工具任务
    // 验证技能被保存
    // 验证技能元数据正确
  });

  test('should not learn from failed task', async () => {
    // 执行失败任务
    // 验证没有技能被保存
  });
});

// 测试场景2: 技能应用
describe('Skill Application', () => {
  test('should load relevant skills for similar task', async () => {
    // 学习技能A
    // 执行相似任务
    // 验证技能A被加载到上下文
  });

  test('should format skills correctly for LLM', () => {
    // 验证技能格式符合规范
  });
});

// 测试场景3: 上下文压缩
describe('Context Compression', () => {
  test('should compress long context', async () => {
    // 创建长上下文 (>4000 tokens)
    // 验证压缩后大小合理
    // 验证关键信息保留
  });
});
```

---

## 8. 未来扩展（Phase 8+）

Phase 7 实现基础学习系统，未来可扩展：

1. **协作学习**：跨用户技能共享（需 opt-in）
2. **技能市场**：用户创建和分享技能
3. **可解释学习**：展示学习原因和技能来源
4. **交互式训练**：用户指导学习和技能优化
5. **多模态学习**：从图像、音频学习
6. **迁移学习**：跨领域应用技能

---

## 9. 附录

### 9.1 术语表

| 术语 | 定义 |
|------|------|
| **Skill** | 可复用的多步骤任务执行模式 |
| **Pattern** | 常见问题的解决方法 |
| **Fact** | 跨会话持久化的信息 |
| **Confidence** | 知识提取的可信度 (0-1) |
| **Success Rate** | 技能使用成功率 |
| **Learning Trigger** | 启动学习循环的条件评估 |

### 9.2 参考资料

- Memory System 设计文档（Phase 3.5）
- Hook Architecture 文档（Phase 6）
- SQLite FTS5 文档
- Context Compression 最佳实践

---

**文档版本**: 1.0  
**创建日期**: 2026-06-14  
**作者**: Miniclaw Development Team  
**状态**: 待审核
