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
 */

import { z } from "zod";
import { ResearchConfigSchema } from "../config/research/schema.js";
import { TopicSchema } from "../topics/schema.js";

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
 * Contains essential topic data without registry overhead.
 */
export const TopicSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    condition: z.string(),
    category: z.string(),
    priority: z.string(),
    status: z.string(),
  })
  .strict();

export type TopicSummary = z.infer<typeof TopicSummarySchema>;

/**
 * Complete research specification schema.
 *
 * This is the top-level contract that governs a research run.
 * It must be fully specified and validated before any research begins.
 */
export const ResearchSpecificationSchema = z
  .object({
    /**
     * Specification schema version for migration support.
     * Follows semantic versioning (major.minor.patch).
     */
    specificationVersion: z.string().regex(/^\d+\.\d+\.\d+$/),

    /**
     * Run metadata (when, who, where).
     */
    runMetadata: RunMetadataSchema,

    /**
     * Research configuration (quality, sources, models).
     * Defines HOW research should be conducted.
     */
    researchConfig: ResearchConfigSchema,

    /**
     * Topics to research.
     * Defines WHAT should be researched.
     */
    topics: z.array(TopicSchema),

    /**
     * Topic summaries for quick reference without full deserialization.
     * Generated automatically during specification creation.
     */
    topicSummaries: z.array(TopicSummarySchema),

    /**
     * Computed statistics about the specification.
     */
    stats: z
      .object({
        totalTopics: z.number().int().min(0),
        activeTopics: z.number().int().min(0),
        uniqueConditions: z.number().int().min(0),
        uniqueCategories: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type ResearchSpecification = z.infer<typeof ResearchSpecificationSchema>;

/**
 * Current specification schema version.
 * Increment when making breaking changes to the schema.
 */
export const SPECIFICATION_VERSION = "1.0.0";
