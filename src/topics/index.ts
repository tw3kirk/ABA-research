/**
 * Topic configuration module.
 *
 * Provides schema-validated topic loading, atomicity validation, and
 * deterministic indexing for research pipeline consumption.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Topics flow through the system as follows:
 *
 * 1. LOADING: Topics are loaded from JSON files using loadTopics() or
 *    loadTopicsOrThrow(). This validates:
 *    - Schema correctness (required fields, types, formats)
 *    - Compatibility with ResearchConfig (valid conditions/categories)
 *    - Uniqueness of topic IDs
 *    - ATOMICITY: Single entity, single claim, single direction
 *
 * 2. ATOMICITY VALIDATION: Each topic must represent ONE atomic research
 *    claim suitable for a single content piece. Validators check for:
 *    - Multiple entities (lists, "and" conjunctions)
 *    - Bucket phrases ("foods that...", "herbs for...")
 *    - Vague quantifiers ("various", "some", "certain")
 *    - Plural nouns without specific entity
 *    - Multiple claims in mechanism
 *
 * 3. REGISTRY: Validated topics are passed to TopicRegistry.create() which:
 *    - Sorts topics deterministically by ID
 *    - Builds indexes for efficient lookup
 *    - Freezes everything for immutability
 *
 * 4. CONSUMPTION: Pipelines access topics through the registry:
 *    - registry.topics - iterate all topics in deterministic order
 *    - registry.getByCondition() - batch by skin condition
 *    - registry.getByCategory() - batch by content type
 *    - registry.filter() - complex queries
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EXAMPLE USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   import { loadTopicsOrThrow, TopicRegistry } from "./topics/index.js";
 *   import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./config/index.js";
 *   import topicData from "../topics/sample-topics.json";
 *
 *   const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
 *   const topics = loadTopicsOrThrow(topicData, config);
 *   const registry = TopicRegistry.create(topics);
 *
 *   // Access patterns for pipelines:
 *   for (const topic of registry.topics) {
 *     // Process each topic in deterministic order
 *   }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMICITY VALIDATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   import { validateTopicAtomicity, formatValidationResult } from "./topics/index.js";
 *
 *   const result = validateTopicAtomicity(topic);
 *   if (!result.isCanonical) {
 *     console.log(formatValidationResult(topic, result));
 *     // Prints structured error with suggestions and examples
 *   }
 */

// Schema and types
export {
  TopicSchema,
  TopicCollectionSchema,
  TopicPriority,
  TopicStatus,
  ClaimDirection,
  EntityType,
  ClaimSchema,
  type Topic,
  type TopicCollection,
  type Claim,
} from "./schema.js";

// Loader and validation
export {
  loadTopics,
  loadTopicsOrThrow,
  formatValidationReport,
  TopicValidationError,
  type TopicIssue,
  type TopicValidationResult,
  type LoadTopicsOptions,
} from "./loader.js";

// Atomicity validators
export {
  validateTopicAtomicity,
  validateTopics,
  formatValidationIssue,
  formatValidationResult,
  type TopicValidationIssue,
  type TopicAtomicityResult,
  type ValidationSeverity,
  type ValidationRule,
} from "./validators.js";

// Registry and indexing
export {
  TopicRegistry,
  makeConditionCategoryKey,
  parseConditionCategoryKey,
  type ConditionCategoryKey,
  type TopicFilter,
  type RegistryStats,
} from "./registry.js";
