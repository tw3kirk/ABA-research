/**
 * Research specification module.
 *
 * The ResearchSpecification is the canonical "contract" for a research run,
 * combining configuration, topics, and run metadata into a single immutable
 * object that flows through all pipeline stages.
 *
 * ARCHITECTURE ROLE:
 *
 * ```
 * ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
 * │  ResearchConfig │     │     Topics      │     │   Run Metadata  │
 * │  (how to run)   │     │  (what to run)  │     │  (when/where)   │
 * └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
 *          │                       │                       │
 *          └───────────────────────┼───────────────────────┘
 *                                  │
 *                                  ▼
 *                    ┌─────────────────────────┐
 *                    │  ResearchSpecification  │
 *                    │  (immutable contract)   │
 *                    └────────────┬────────────┘
 *                                 │
 *          ┌──────────────────────┼──────────────────────┐
 *          │                      │                      │
 *          ▼                      ▼                      ▼
 *   ┌─────────────┐      ┌─────────────┐       ┌─────────────┐
 *   │  Research   │      │   Content   │       │   Output    │
 *   │   Stage     │      │   Stage     │       │   Stage     │
 *   └─────────────┘      └─────────────┘       └─────────────┘
 * ```
 *
 * USAGE EXAMPLE:
 *
 * ```typescript
 * import { createSpecification, saveSpecification } from "./specification/index.js";
 * import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./config/index.js";
 * import { loadTopicsOrThrow, TopicRegistry } from "./topics/index.js";
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
 * // Use in pipeline
 * for (const topic of spec.topics) {
 *   // Research each topic according to spec.researchConfig
 * }
 * ```
 *
 * IMMUTABILITY GUARANTEE:
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
  SPECIFICATION_VERSION,
  type ResearchSpecification,
  type GitState,
  type RunMetadata,
  type TopicSummary,
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
