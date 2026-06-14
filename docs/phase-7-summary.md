# Phase 7 实施方案摘要

## 核心目标

实现 **Learning Loop（学习循环）** 和 **Skills System（技能系统）**，使 Miniclaw 能够从过去的执行中学习并复用成功的模式。

## 三大核心能力

```
┌─────────────────────────────────────────────────────────┐
│                    Phase 7 核心能力                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. 学习能力  ──▶  从成功对话中自动提取知识              │
│                                                          │
│  2. 存储能力  ──▶  将知识结构化为技能（Skill/Pattern）   │
│                                                          │
│  3. 应用能力  ──▶  在相似任务中加载和使用技能             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## 系统架构

```
              MemoryHooks (集成点)
                    │
    ┌───────────────┼───────────────┐
    │               │               │
    ▼               ▼               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Learning│   │Knowledge│   │Learning │
│Triggers │   │Extractor│   │Storage  │
└────┬────┘   └────┬────┘   └────┬────┘
     │             │             │
     └─────────────┴─────────────┘
                   │
             ┌─────┴─────┐
             │           │
             ▼           ▼
        ┌─────────┐ ┌─────────┐
        │Skill    │ │Context  │
        │Loader   │ │Compressor│
        └─────────┘ └─────────┘
```

## 关键组件

| 组件 | 职责 | 输入 | 输出 |
|------|------|------|------|
| **LearningTriggers** | 评估是否应该学习 | 对话上下文 | shouldLearn: boolean |
| **KnowledgeExtractor** | 提取结构化知识 | 对话ID | ExtractedKnowledge[] |
| **LearningStorage** | 存储管理技能 | LearnedSkill | - |
| **SkillLoader** | 加载相关技能 | 任务描述 | Skill[] |
| **ContextCompressor** | 压缩上下文 | 长上下文 | 压缩后上下文 |

## 学习流程

```
[任务完成]
    │
    ▼
评估学习条件 ◀─── 轮数1-3? 工具数2-5? 成功?
    │
    ▼
提取知识 ◀─── 分析工具序列
    │
    ▼
存储技能 ◀─── 保存到 learned_skills 表
    │
    ▼
[学习完成]
```

## 技能应用流程

```
[新任务]
    │
    ▼
搜索相关技能 ◀─── FTS5 搜索 learned_skills_fts
    │
    ▼
过滤排序 ◀─── 按成功率、使用次数排序
    │
    ▼
取Top 3 ◀─── 避免上下文膨胀
    │
    ▼
注入上下文 ◀─── 格式化为 LLM 可读格式
    │
    ▼
[LLM使用技能]
```

## 学习质量矩阵

| 指标 | 高质量（学习） | 低质量（跳过） |
|------|----------------|----------------|
| 对话轮数 | 1-3 轮 | 7+ 轮 |
| 工具数量 | 2-5 个 | 0 个 |
| 错误恢复 | 有恢复 | 有错误未恢复 |
| 成功率 | 100% | <100% |

## 技能类型

1. **Skill（技能）**: 可复用的多步骤程序
   - 示例：部署流程（git push → kubectl apply → 验证）

2. **Pattern（模式）**: 常见问题解决方法
   - 示例：文件分析流程（Read → Parse → Transform）

3. **Fact（事实）**: 跨会话持久化信息
   - 示例：用户偏好配置

## 数据库 Schema

```sql
CREATE TABLE learned_skills (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'skill', 'pattern', 'fact'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  task_pattern TEXT NOT NULL,      -- 用于匹配
  tool_sequence TEXT NOT NULL,    -- JSON: 工具执行序列
  outcome TEXT NOT NULL,
  user_id TEXT NOT NULL,
  learned_from TEXT NOT NULL,      -- 来源对话ID
  learned_at INTEGER NOT NULL,
  times_used INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 1.0
);

-- FTS5 全文搜索
CREATE VIRTUAL TABLE learned_skills_fts USING fts5(
  title, description, outcome,
  content=learned_skills
);
```

## 上下文压缩策略

```
原始上下文 (5000 tokens)
    │
    ▼
┌─────────────────────────────┐
│ 压缩分析                    │
├─────────────────────────────┤
│ ✓ 保留:                    │
│   - 当前任务                │
│   - 最近2轮对话             │
│   - 高成功率技能 (>0.8)     │
│                             │
│ ℹ 压缩:                     │
│   - 早期对话 (总结)         │
│   - 工具输出 (200字符)       │
│                             │
│ ✗ 移除:                     │
│   - 低成功率技能 (<0.5)     │
│   - 重复信息                │
└─────────────────────────────┘
    │
    ▼
压缩后 (2500-3000 tokens)
```

## 集成点

在 `MemoryHooks` 中添加两个钩子处理：

```typescript
// 1. afterDynamicContext: 加载技能
async onAfterDynamicContext(context) {
  // 现有: 搜索历史对话...
  
  // 新增: 加载相关技能
  const skills = this.skillLoader.loadRelevantSkills(
    context.task, 
    context.userId, 
    3  // 最多3个技能
  );
  
  if (skills.length > 0) {
    context.context += formatSkills(skills);
  }
}

// 2. afterExecute: 学习循环
async onAfterExecute(context) {
  // 评估学习条件
  const trigger = this.learningTriggers.evaluate(context);
  
  if (trigger.shouldLearn) {
    // 提取知识
    const knowledge = await this.knowledgeExtractor.extract(
      context.conversationId
    );
    
    // 存储技能
    for (const k of knowledge) {
      this.learningStorage.saveSkill(k);
    }
  }
}
```

## 实施时间线

```
Week 1-2: 基础设施
  ├─ LearningTriggers
  ├─ LearningStorage + 数据库迁移
  └─ KnowledgeExtractor

Week 3: 技能系统
  ├─ SkillLoader
  └─ SkillApplication

Week 4: 集成与优化
  ├─ ContextCompressor
  ├─ MemoryHooks 扩展
  └─ Agent 配置更新

Week 5-6: 测试与部署
  ├─ 集成测试
  ├─ 性能优化
  └─ 生产部署
```

## 成功标准

- [ ] 学习精确率 >70%（学到的技能中相关技能占比）
- [ ] 学习召回率 >60%（应该学习的技能中实际学习的占比）
- [ ] 压缩率 30-50%
- [ ] 性能开销 <100ms/对话

## 风险缓解

| 风险 | 缓解措施 |
|------|----------|
| 低质量技能污染 | 保守阈值、技能修剪 |
| 上下文膨胀 | 技能数量限制、激进压缩 |
| LLM 成本 | 批量处理、使用小模型 |
| 学习阻塞任务 | 完全异步执行 |

---

**Phase 7 核心**: 让 Miniclaw 从"一次性执行器"进化为"持续学习的智能体"
