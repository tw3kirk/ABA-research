/**
 * Topic configuration module.
 *
 * Provides schema-validated topic loading and deterministic indexing
 * for research pipeline consumption.
 *
 * ARCHITECTURE OVERVIEW:
 *
 * Topics flow through the system as follows:
 *
 * 1. LOADING: Topics are loaded from JSON files (or other sources in future)
 *    using loadTopics() or loadTopicsOrThrow(). This validates:
 *    - Schema correctness (required fields, types, formats)
 *    - Compatibility with ResearchConfig (valid conditions/categories)
 *    - Uniqueness of topic IDs
 *
 * 2. REGISTRY: Validated topics are passed to TopicRegistry.create() which:
 *    - Sorts topics deterministically by ID
 *    - Builds indexes for efficient lookup
 *    - Freezes everything for immutability
 *
 * 3. CONSUMPTION: Pipelines access topics through the registry:
 *    - registry.topics - iterate all topics in deterministic order
 *    - registry.getByCondition() - batch by skin condition
 *    - registry.getByCategory() - batch by content type
 *    - registry.getByConditionAndCategory() - precise targeting
 *    - registry.filter() - complex queries
 *
 * EXAMPLE USAGE:
 *
 *   import { loadTopicsOrThrow, TopicRegistry } from "./topics/index.js";
 *   import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./config/index.js";
 *   import topicData from "../topics/sample-topics.json";
 *
 *   const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
 *   const topics = loadTopicsOrThrow(topicData, config);
 *   const registry = TopicRegistry.create(topics);
 *
 *   // Access patterns for future pipelines:
 *   for (const topic of registry.topics) {
 *     // Process each topic in deterministic order
 *   }
 *
 *   const acneTopics = registry.getByCondition("acne");
 *   const treatmentTopics = registry.getByCategory("treatment_options");
 */

// Schema and types
export {
  TopicSchema,
  TopicCollectionSchema,
  TopicPriority,
  TopicStatus,
  type Topic,
  type TopicCollection,
} from "./schema.js";

// Loader and validation
export {
  loadTopics,
  loadTopicsOrThrow,
  TopicValidationError,
  type TopicIssue,
  type TopicValidationResult,
} from "./loader.js";

// Registry and indexing
export {
  TopicRegistry,
  makeConditionCategoryKey,
  parseConditionCategoryKey,
  type ConditionCategoryKey,
  type TopicFilter,
  type RegistryStats,
} from "./registry.js";
