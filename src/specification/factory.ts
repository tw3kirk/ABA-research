/**
 * Research specification factory.
 *
 * Creates immutable research specifications that serve as the canonical
 * input contract for all pipeline stages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE IN PIPELINE STAGES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The specification flows through the pipeline as follows:
 *
 * 1. INITIALIZATION: Created once at run start with all inputs validated.
 *    Topics must pass atomic validation (single entity, single claim).
 *
 * 2. RESEARCH STAGE (Phase 2): Uses spec.topics to determine what to research.
 *    Each topic has:
 *    - primaryEntity: What to research ("turmeric", "dairy", etc.)
 *    - entityType: How to frame it (food, herb, chemical)
 *    - claim: Direction (helps/harms) + mechanism placeholder
 *
 *    Phase 2 generators fill in claim.mechanism with evidence-backed content.
 *
 * 3. BATCH PROCESSING: Uses spec.topicIndexes for efficient grouping:
 *    - byCondition: Process all acne topics together
 *    - byCategory: Process all vegan foods together
 *    - byEntityType: Handle foods differently from chemicals
 *    - byClaimDirection: Frame "helps" differently from "harms"
 *
 * 4. CONTENT GENERATION: Uses spec.researchConfig.allowedOutputFormats
 *    to determine valid output types, spec.topics for content structure
 *
 * 5. OUTPUT STAGE: Uses spec.runMetadata.runId for file naming,
 *    serializes full spec for audit trail
 *
 * 6. AUDIT/REPLAY: Deserializes spec from disk to reproduce exact run
 */

import type { ResearchConfig } from "../config/research/schema.js";
import type { Topic, EntityType, ClaimDirection } from "../topics/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";
import type { SeoGuidelines } from "../standards/seo-schema.js";
import type { SkinCondition, ContentCategory } from "../config/research/enums.js";
import {
  type ResearchSpecification,
  type TopicSummary,
  type TopicIndexMaps,
  ResearchSpecificationSchema,
  SPECIFICATION_VERSION,
} from "./schema.js";
import { createRunMetadata, type RunMetadataOptions } from "./metadata.js";

/**
 * Deep freeze an object and all nested objects.
 * Prevents any mutation of the specification after creation.
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  // Get all property names including symbols
  const propNames = Reflect.ownKeys(obj);

  // Freeze nested objects first (depth-first)
  for (const name of propNames) {
    const value = (obj as Record<string | symbol, unknown>)[name];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }

  return Object.freeze(obj);
}

/**
 * Create topic summaries with atomic topic fields for quick reference.
 *
 * PHASE 2 NOTE: These summaries include the full claim structure,
 * allowing Phase 2 generators to understand the research thesis
 * without deserializing full topic objects.
 */
function createTopicSummaries(topics: Topic[]): TopicSummary[] {
  return topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    primaryEntity: topic.primaryEntity,
    entityType: topic.entityType,
    claim: {
      direction: topic.claim.direction,
      mechanism: topic.claim.mechanism,
      confidence: topic.claim.confidence,
    },
    condition: topic.condition,
    category: topic.category,
    priority: topic.priority,
    status: topic.status,
  }));
}

/**
 * Create pre-computed index maps for batch processing.
 *
 * Indexes are stored as arrays of [key, topicIds[]] tuples for JSON serialization.
 * Each topic is referenced by ID for deduplication and lookup.
 *
 * PHASE 2 NOTE: Use these indexes to batch topics efficiently:
 * - byCondition: Process all topics for one skin condition together
 * - byCategory: Process all topics in one content category
 * - byEntityType: Group foods, herbs, chemicals for appropriate framing
 * - byClaimDirection: Separate "helps" from "harms" research
 */
function createIndexMaps(topics: Topic[]): TopicIndexMaps {
  // Build Maps for efficient grouping
  const byCondition = new Map<SkinCondition, string[]>();
  const byCategory = new Map<ContentCategory, string[]>();
  const byEntityType = new Map<EntityType, string[]>();
  const byClaimDirection = new Map<ClaimDirection, string[]>();

  for (const topic of topics) {
    // Index by condition
    const conditionIds = byCondition.get(topic.condition) ?? [];
    conditionIds.push(topic.id);
    byCondition.set(topic.condition, conditionIds);

    // Index by category
    const categoryIds = byCategory.get(topic.category) ?? [];
    categoryIds.push(topic.id);
    byCategory.set(topic.category, categoryIds);

    // Index by entity type
    const entityTypeIds = byEntityType.get(topic.entityType) ?? [];
    entityTypeIds.push(topic.id);
    byEntityType.set(topic.entityType, entityTypeIds);

    // Index by claim direction
    const directionIds = byClaimDirection.get(topic.claim.direction) ?? [];
    directionIds.push(topic.id);
    byClaimDirection.set(topic.claim.direction, directionIds);
  }

  // Convert to serializable tuple arrays (sorted by key for determinism)
  return {
    byCondition: Array.from(byCondition.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
    byCategory: Array.from(byCategory.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
    byEntityType: Array.from(byEntityType.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
    byClaimDirection: Array.from(byClaimDirection.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
  };
}

/**
 * Compute specification statistics including atomic topic breakdowns.
 *
 * PHASE 2 NOTE: Stats provide quick insight into the research scope:
 * - helpsClaims/harmsClaims: Balance of positive vs negative research
 * - uniqueEntityTypes: Diversity of entity types being researched
 */
function computeStats(topics: Topic[]): ResearchSpecification["stats"] {
  const activeTopics = topics.filter((t) => t.status === "active");
  const conditions = new Set(topics.map((t) => t.condition));
  const categories = new Set(topics.map((t) => t.category));
  const entityTypes = new Set(topics.map((t) => t.entityType));

  const helpsClaims = topics.filter((t) => t.claim.direction === "helps").length;
  const harmsClaims = topics.filter((t) => t.claim.direction === "harms").length;

  return {
    totalTopics: topics.length,
    activeTopics: activeTopics.length,
    uniqueConditions: conditions.size,
    uniqueCategories: categories.size,
    uniqueEntityTypes: entityTypes.size,
    helpsClaims,
    harmsClaims,
  };
}

/**
 * Options for creating a research specification.
 */
export interface CreateSpecificationOptions {
  /** Run ID for this execution */
  runId: string;

  /** Research configuration */
  researchConfig: ResearchConfig;

  /** Topics to research */
  topics: Topic[];

  /** Optional: content standards for generated content */
  contentStandards?: ContentStandards;

  /** Optional: SEO guidelines for generated content */
  seoGuidelines?: SeoGuidelines;

  /** Optional: override start timestamp */
  startedAt?: Date;

  /** Optional: user who initiated the run */
  initiatedBy?: string;

  /** Optional: disable git state capture */
  captureGit?: boolean;

  /** Optional: additional context */
  context?: Record<string, unknown>;
}

/**
 * Create a new research specification.
 *
 * This is the primary factory function for creating specifications.
 * The returned specification is deeply frozen and cannot be modified.
 *
 * @param options - Specification options
 * @returns Immutable research specification
 * @throws Error if validation fails
 */
export function createSpecification(
  options: CreateSpecificationOptions
): Readonly<ResearchSpecification> {
  // Sort topics by ID for deterministic ordering
  const sortedTopics = [...options.topics].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  // Create run metadata
  const runMetadata = createRunMetadata({
    runId: options.runId,
    startedAt: options.startedAt,
    initiatedBy: options.initiatedBy,
    captureGit: options.captureGit,
    context: options.context,
  });

  // Build the specification with pre-computed indexes
  const spec: ResearchSpecification = {
    specificationVersion: SPECIFICATION_VERSION,
    runMetadata,
    researchConfig: options.researchConfig,
    topics: sortedTopics,
    topicSummaries: createTopicSummaries(sortedTopics),
    topicIndexes: createIndexMaps(sortedTopics),
    stats: computeStats(sortedTopics),
    contentStandards: options.contentStandards,
    seoGuidelines: options.seoGuidelines,
  };

  // Validate against schema (should always pass if inputs were valid)
  const result = ResearchSpecificationSchema.safeParse(spec);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid specification: ${errors}`);
  }

  // Deep freeze for immutability
  return deepFreeze(result.data);
}

/**
 * Validation error for specification loading.
 */
export class SpecificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecificationError";
  }
}
