/**
 * Research specification schema definitions.
 *
 * The ResearchSpecification is the canonical "contract" for a research run.
 * It captures everything needed to reproduce the run:
 *
 * 1. WHAT: Topics to research (from TopicRegistry)
 * 2. HOW: Research configuration (from ResearchConfig)
 * 3. WHEN: Run metadata (timestamp, identifiers)
 * 4. WHERE: Environment context (git commit, tool versions)
 * 5. INDEXES: Pre-computed lookup maps for efficient batch processing
 *
 * IMMUTABILITY CONTRACT:
 * Once created, a specification cannot be modified. This ensures:
 * - All pipeline stages see identical input
 * - Audit logs accurately reflect what was executed
 * - Reproductions use exact same parameters
 *
 * VERSIONING:
 * The specificationVersion field enables schema evolution. Loaders
 * should check this version and apply migrations if needed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 CONSUMPTION — Research Generation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 2 research generators consume this specification as follows:
 *
 * 1. TOPIC ITERATION: Iterate spec.topics for all atomic topics. Each topic
 *    contains primaryEntity, entityType, and claim with direction/mechanism.
 *    The mechanism field may be a placeholder ("to be researched") that Phase 2
 *    fills in with evidence-backed content.
 *
 * 2. BATCH PROCESSING: Use spec.topicIndexes to batch topics:
 *    - byCondition: Process all topics for one skin condition together
 *    - byCategory: Process all topics in one content category
 *    - byEntityType: Group foods, herbs, chemicals separately
 *    - byClaimDirection: Separate "helps" vs "harms" research
 *
 * 3. CLAIM GENERATION: For each topic, generate research content that:
 *    - Validates or refines the claim.mechanism with citations
 *    - Maintains claim.direction (helps/harms) consistency
 *    - Updates claim.confidence based on evidence quality
 *
 * 4. OUTPUT BINDING: Use spec.runMetadata.runId for output file naming.
 *    Serialize updated topics back to spec-compatible format.
 */

import { z } from "zod";
import { ResearchConfigSchema } from "../config/research/schema.js";
import { TopicSchema, ClaimSchema, EntityType, ClaimDirection } from "../topics/schema.js";
import { ContentStandardsSchema } from "../standards/content-schema.js";
import { SeoGuidelinesSchema } from "../standards/seo-schema.js";
import { SkinCondition, ContentCategory } from "../config/research/enums.js";

/**
 * Git repository state at time of run.
 */
export const GitStateSchema = z
  .object({
    /** Current commit SHA (full 40 chars) */
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),

    /** Short commit SHA (7 chars) */
    commitShort: z.string().regex(/^[a-f0-9]{7}$/),

    /** Current branch name */
    branch: z.string(),

    /** Whether working directory has uncommitted changes */
    isDirty: z.boolean(),

    /** Commit timestamp (ISO 8601) */
    commitDate: z.string().datetime({ offset: true }),
  })
  .strict();

export type GitState = z.infer<typeof GitStateSchema>;

/**
 * Run metadata capturing when and how the run was initiated.
 */
export const RunMetadataSchema = z
  .object({
    /** Unique run identifier (from logging/run-id) */
    runId: z.string().min(1),

    /** Run start timestamp (ISO 8601) */
    startedAt: z.string().datetime(),

    /** Machine/environment identifier */
    hostname: z.string().optional(),

    /** User who initiated the run */
    initiatedBy: z.string().optional(),

    /** Git state if available */
    git: GitStateSchema.optional(),

    /** Additional context for the run */
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/**
 * Topic summary for serialization.
 *
 * Contains essential topic data for quick reference and Phase 2 processing.
 * Includes the complete atomic topic structure:
 * - primaryEntity: The single thing being researched
 * - entityType: Classification (food, herb, ingredient, etc.)
 * - claim: Directional assertion with mechanism placeholder
 *
 * PHASE 2 NOTE: Research generators use this summary to:
 * - Understand what entity to research (primaryEntity)
 * - Frame research appropriately (entityType)
 * - Investigate the specific claim (claim.direction + mechanism)
 * - Fill in mechanism placeholders with evidence-backed content
 */
export const TopicSummarySchema = z
  .object({
    /** Unique topic identifier for cross-referencing */
    id: z.string(),

    /** Human-readable topic name */
    name: z.string(),

    /**
     * The single primary entity being researched.
     * Examples: "turmeric", "avocado", "retinol", "dairy"
     */
    primaryEntity: z.string(),

    /**
     * Classification of what the entity is.
     * Helps Phase 2 generators frame research appropriately.
     */
    entityType: EntityType,

    /**
     * The directional claim about this entity's effect on skin.
     * Phase 2 generators use this to:
     * - Investigate evidence for/against the direction
     * - Fill in or refine the mechanism with citations
     * - Update confidence based on evidence quality
     */
    claim: ClaimSchema,

    /** Target skin condition from canonical 4 */
    condition: z.string(),

    /** Content category from canonical 10 */
    category: z.string(),

    /** Processing priority */
    priority: z.string(),

    /** Lifecycle status */
    status: z.string(),
  })
  .strict();

export type TopicSummary = z.infer<typeof TopicSummarySchema>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOPIC INDEX MAPS — Pre-computed lookups for batch processing
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Index maps provide O(1) lookup by common grouping dimensions.
 * These are serialized as arrays of [key, topicIds[]] pairs.
 *
 * PHASE 2 NOTE: Research generators use these indexes to:
 * - Batch research by condition (all acne topics together)
 * - Batch by category (all Ayurvedic herb topics)
 * - Separate helps/harms for appropriate framing
 * - Group entity types for consistent treatment
 */
export const TopicIndexMapsSchema = z
  .object({
    /**
     * Topics grouped by skin condition.
     * Use to process all topics for one condition together.
     */
    byCondition: z.array(
      z.tuple([SkinCondition, z.array(z.string())])
    ),

    /**
     * Topics grouped by content category.
     * Use to batch content generation by category.
     */
    byCategory: z.array(
      z.tuple([ContentCategory, z.array(z.string())])
    ),

    /**
     * Topics grouped by entity type.
     * Use for entity-type-specific research framing.
     */
    byEntityType: z.array(
      z.tuple([EntityType, z.array(z.string())])
    ),

    /**
     * Topics grouped by claim direction.
     * Use to separate positive (helps) from negative (harms) research.
     */
    byClaimDirection: z.array(
      z.tuple([ClaimDirection, z.array(z.string())])
    ),
  })
  .strict();

export type TopicIndexMaps = z.infer<typeof TopicIndexMapsSchema>;

/**
 * Complete research specification schema.
 *
 * This is the top-level contract that governs a research run.
 * It must be fully specified and validated before any research begins.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PHASE 2 RESEARCH GENERATOR CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Phase 2 generators receive this specification and MUST:
 *
 * 1. Read topics in deterministic order (sorted by ID)
 * 2. Use topicIndexes for batch processing optimizations
 * 3. Preserve all original topic fields
 * 4. Fill in claim.mechanism placeholders with evidence
 * 5. Update claim.confidence based on evidence quality
 * 6. Generate outputs named with runMetadata.runId
 *
 * Phase 2 generators MUST NOT:
 * - Modify the specification itself (it's frozen)
 * - Change claim.direction without explicit user override
 * - Skip validation of generated content against standards
 * - Ignore seoGuidelines or contentStandards if present
 */
export const ResearchSpecificationSchema = z
  .object({
    /**
     * Specification schema version for migration support.
     * Follows semantic versioning (major.minor.patch).
     * Version 2.0.0 introduced atomic topics and index maps.
     */
    specificationVersion: z.string().regex(/^\d+\.\d+\.\d+$/),

    /**
     * Run metadata (when, who, where).
     * Phase 2 uses runId for output file naming and audit correlation.
     */
    runMetadata: RunMetadataSchema,

    /**
     * Research configuration (quality, sources, models).
     * Defines HOW research should be conducted.
     * Phase 2 uses qualityRequirements.minCitationsPerClaim to validate output.
     */
    researchConfig: ResearchConfigSchema,

    /**
     * Topics to research — full atomic topic objects.
     * Defines WHAT should be researched.
     *
     * PHASE 2: Iterate these for research generation. Each topic contains:
     * - primaryEntity: What to research
     * - entityType: How to frame the research
     * - claim: The thesis to investigate (direction + mechanism)
     */
    topics: z.array(TopicSchema),

    /**
     * Topic summaries with atomic fields for quick reference.
     * Generated automatically during specification creation.
     *
     * PHASE 2: Use for progress tracking and lightweight iteration
     * without deserializing full topic objects.
     */
    topicSummaries: z.array(TopicSummarySchema),

    /**
     * Pre-computed index maps for batch processing.
     * Each map contains [key, topicIds[]] pairs for O(1) lookup.
     *
     * PHASE 2: Use for efficient batch processing:
     * - byCondition: Process all acne topics, then redness, etc.
     * - byCategory: Process all vegan foods, then Ayurvedic herbs, etc.
     * - byEntityType: Batch foods separately from chemicals
     * - byClaimDirection: Separate helps/harms for appropriate framing
     */
    topicIndexes: TopicIndexMapsSchema,

    /**
     * Computed statistics about the specification.
     * Extended with entity type and claim direction breakdowns.
     */
    stats: z
      .object({
        totalTopics: z.number().int().min(0),
        activeTopics: z.number().int().min(0),
        uniqueConditions: z.number().int().min(0),
        uniqueCategories: z.number().int().min(0),
        uniqueEntityTypes: z.number().int().min(0),
        helpsClaims: z.number().int().min(0),
        harmsClaims: z.number().int().min(0),
      })
      .strict(),

    /**
     * Content standards (tone, citations, forbidden content, brand).
     * Declarative constraints that govern all generated content.
     * Optional - if not provided, no content constraints are enforced.
     *
     * PHASE 2: Validate all generated content against these standards.
     */
    contentStandards: ContentStandardsSchema.optional(),

    /**
     * SEO guidelines (keywords, headings, readability).
     * Declarative constraints for search engine optimization.
     * Optional - if not provided, no SEO constraints are enforced.
     *
     * PHASE 2: Apply to blog/article content generation.
     */
    seoGuidelines: SeoGuidelinesSchema.optional(),
  })
  .strict();

export type ResearchSpecification = z.infer<typeof ResearchSpecificationSchema>;

/**
 * Current specification schema version.
 * Increment when making breaking changes to the schema.
 *
 * Version history:
 * - 1.0.0: Initial specification with basic topics
 * - 2.0.0: Added atomic topic fields (primaryEntity, entityType, claim) and
 *          pre-computed topic indexes for batch processing
 */
export const SPECIFICATION_VERSION = "2.0.0";
