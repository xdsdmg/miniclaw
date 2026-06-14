/**
 * Learning System
 *
 * Phase 7: Learning Loop and Skills System
 * Exports all learning-related modules
 */

// Triggers
export {
  LearningTriggers,
  type LearningContext,
  type LearningTriggerResult,
} from './triggers';

// Storage
export {
  LearningStorage,
  type LearnedSkill,
  type ToolStep,
  type SkillMetadata,
} from './storage';

// Extractor
export {
  KnowledgeExtractor,
  type ExtractedKnowledge,
  type ExtractionContext,
} from './extractor';

// Skills
export {
  SkillLoader,
  SkillApplication,
  type Skill,
  type SkillMatch,
  type ApplicationMode,
  type SkillApplicationResult,
} from './skills';

// Compression (Week 4)
export {
  ContextCompressor,
  type ChatMessage,
  type CompressionStrategy,
  type CompressionResult,
} from './compression';

// Summarizer (Week 4)
export {
  SmartSummarizer,
  type SummaryResult,
  type SummaryStrategy,
} from './summarizer';

// More modules will be added in subsequent weeks:
// - Integration with MemoryHooks (Week 4)
