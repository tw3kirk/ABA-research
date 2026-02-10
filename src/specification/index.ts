/**
 * Research specification module.
 *
 * The ResearchSpecification is the canonical "contract" for a research run,
 * combining configuration, topics, and run metadata into a single immutable
 * object that flows through all pipeline stages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE ROLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```
 * ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
 * │  ResearchConfig │     │  Atomic Topics  │     │   Run Metadata  │
 * │  (how to run)   │     │  (what to run)  │     │  (when/where)   │
 * └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
 *          │                       │                       │
 *          └───────────────────────┼───────────────────────┘
 *                                  │
 *                                  ▼
 *                    ┌─────────────────────────┐
 *                    │  ResearchSpecification  │
 *                    │  (immutable contract)   │
 *                    │  + topicIndexes         │
 *                    └────────────┬────────────┘
 *                                 │
 *          ┌──────────────────────┼──────────────────────┐
 *          │                      │                      │
 *          ▼                      ▼                      ▼
 *   ┌─────────────┐      ┌─────────────┐       ┌─────────────┐
 *   │  Phase 2    │      │   Content   │       │   Output    │
 *   │  Research   │      │   Stage     │       │   Stage     │
 *   └─────────────┘      └─────────────┘       └─────────────┘
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 USAGE — Research Generation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```typescript
 * import { createSpecification, saveSpecification } from "./specification/index.js";
 * import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./config/index.js";
 * import { loadTopicsOrThrow } from "./topics/index.js";
 * import { initRunId } from "./logging/index.js";
 *
 * // Initialize
 * const runId = initRunId();
 * const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
 * const topics = loadTopicsOrThrow(topicData, config);
 *
 * // Create specification
 * const spec = createSpecification({
 *   runId,
 *   researchConfig: config,
 *   topics,
 *   initiatedBy: "automated-pipeline",
 * });
 *
 * // Save for audit
 * saveSpecification(spec, "output/specifications");
 *
 * // PHASE 2: Research each atomic topic
 * for (const topic of spec.topics) {
 *   // topic.primaryEntity: What to research ("turmeric", "dairy")
 *   // topic.entityType: How to frame it (food, herb, chemical)
 *   // topic.claim.direction: The thesis (helps or harms)
 *   // topic.claim.mechanism: Fill this with evidence-backed content
 * }
 *
 * // PHASE 2: Batch by condition for efficient processing
 * for (const [condition, topicIds] of spec.topicIndexes.byCondition) {
 *   // Process all topics for this skin condition together
 *   const conditionTopics = topicIds.map(id =>
 *     spec.topics.find(t => t.id === id)!
 *   );
 * }
 *
 * // PHASE 2: Separate helps from harms for appropriate framing
 * for (const [direction, topicIds] of spec.topicIndexes.byClaimDirection) {
 *   // "helps" topics need positive framing
 *   // "harms" topics need warning framing
 * }
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IMMUTABILITY GUARANTEE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The specification is deeply frozen after creation. Any attempt to modify
 * it will throw a TypeError at runtime. This ensures:
 *
 * 1. All pipeline stages see identical input
 * 2. Serialized specifications exactly match runtime state
 * 3. No accidental mutation corrupts the audit trail
 */

// Schema and types
export {
  ResearchSpecificationSchema,
  GitStateSchema,
  RunMetadataSchema,
  TopicSummarySchema,
  TopicIndexMapsSchema,
  SPECIFICATION_VERSION,
  type ResearchSpecification,
  type GitState,
  type RunMetadata,
  type TopicSummary,
  type TopicIndexMaps,
} from "./schema.js";

// Metadata capture
export {
  captureGitState,
  createRunMetadata,
  type RunMetadataOptions,
} from "./metadata.js";

// Factory
export {
  createSpecification,
  SpecificationError,
  type CreateSpecificationOptions,
} from "./factory.js";

// Serialization
export {
  serializeSpecification,
  deserializeSpecification,
  saveSpecification,
  loadSpecification,
  getSpecificationFilename,
  isVersionCompatible,
  summarizeSpecification,
  type SummaryOptions,
} from "./serialization.js";
