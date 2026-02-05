/**
 * Research configuration schema definition.
 *
 * IMMUTABILITY RATIONALE:
 * This configuration must remain immutable for the duration of a research run because:
 *
 * 1. REPRODUCIBILITY: Research outputs must be traceable to exact configuration.
 *    Changing config mid-run would make results impossible to reproduce.
 *
 * 2. CONSISTENCY: All pipeline stages must operate under identical assumptions.
 *    A citation requirement change mid-run could invalidate earlier work.
 *
 * 3. AUDITABILITY: For compliance and review, we must know exactly what
 *    parameters governed any piece of generated content.
 *
 * 4. DEBUGGING: When issues arise, frozen config allows deterministic replay.
 *
 * The config is validated once at startup and then treated as read-only.
 * Any config changes require a new run with a new run ID.
 */

import { z } from "zod";
import {
  SkinCondition,
  ContentCategory,
  OutputFormat,
  EvidenceType,
  SourceType,
} from "./enums.js";

/**
 * Quality requirements for research outputs.
 */
export const QualityRequirementsSchema = z
  .object({
    /** Minimum number of citations required per claim */
    minCitationsPerClaim: z
      .number()
      .int()
      .min(1)
      .describe("Minimum citations required to support each factual claim"),

    /** Minimum number of unique sources per topic */
    minSourcesPerTopic: z
      .number()
      .int()
      .min(1)
      .describe("Minimum unique sources required per research topic"),

    /** Maximum age of sources in years (0 = no limit) */
    maxSourceAgeYears: z
      .number()
      .int()
      .min(0)
      .describe("Maximum age of acceptable sources in years; 0 means no limit"),

    /** Allowed evidence types for citations */
    allowedEvidenceTypes: z
      .array(EvidenceType)
      .min(1)
      .describe("Types of evidence that are acceptable for citations"),

    /** Require at least one high-quality source (systematic review, RCT, guideline) */
    requireHighQualitySource: z
      .boolean()
      .describe(
        "Whether at least one systematic review, RCT, or clinical guideline is required"
      ),
  })
  .strict();

export type QualityRequirements = z.infer<typeof QualityRequirementsSchema>;

/**
 * Source policy governing what materials can be used.
 */
export const SourcePolicySchema = z
  .object({
    /** Allowed source types */
    allowedSourceTypes: z
      .array(SourceType)
      .min(1)
      .describe("Types of sources that are acceptable for research"),

    /** Whether preprints are allowed (requires explicit opt-in) */
    allowPreprints: z
      .boolean()
      .describe("Whether non-peer-reviewed preprints are acceptable"),

    /** Require peer review for primary sources */
    requirePeerReview: z
      .boolean()
      .describe("Whether primary research sources must be peer-reviewed"),

    /** Excluded publishers or journals (by name pattern) */
    excludedPublishers: z
      .array(z.string())
      .describe("Publisher or journal names to exclude from research"),

    /** Excluded domains for web sources */
    excludedDomains: z
      .array(z.string())
      .describe("Web domains to exclude from research"),

    /** Preferred databases for source retrieval */
    preferredDatabases: z
      .array(z.string())
      .describe("Preferred databases for source retrieval (e.g., PubMed, Cochrane)"),
  })
  .strict();

export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

/**
 * Model and tooling metadata.
 */
export const ModelMetadataSchema = z
  .object({
    /** Primary LLM model identifier */
    modelName: z.string().min(1).describe("Primary LLM model identifier"),

    /** Model version or checkpoint */
    modelVersion: z
      .string()
      .min(1)
      .describe("Specific model version or checkpoint"),

    /** Research tool or framework used */
    researchTool: z
      .string()
      .min(1)
      .describe("Research tool or framework identifier"),

    /** Research tool version */
    researchToolVersion: z
      .string()
      .min(1)
      .describe("Version of the research tool"),

    /** Configuration schema version for migration support */
    configSchemaVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .describe("Semantic version of this configuration schema"),
  })
  .strict();

export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;

/**
 * Complete research configuration schema.
 *
 * This is the top-level configuration that governs all research operations.
 * It must be fully specified and validated before any research begins.
 */
export const ResearchConfigSchema = z
  .object({
    /**
     * Supported skin conditions.
     * Only conditions in this list can be researched in this run.
     */
    supportedConditions: z
      .array(SkinCondition)
      .min(1)
      .describe("Skin conditions enabled for research in this run"),

    /**
     * Supported content categories.
     * Defines the types of research content that can be generated.
     */
    supportedCategories: z
      .array(ContentCategory)
      .min(1)
      .describe("Content categories enabled for this run"),

    /**
     * Allowed output formats.
     * Content can only be generated in these formats.
     */
    allowedOutputFormats: z
      .array(OutputFormat)
      .min(1)
      .describe("Output formats that can be generated"),

    /**
     * Research quality requirements.
     * Minimum standards that all research outputs must meet.
     */
    qualityRequirements: QualityRequirementsSchema.describe(
      "Quality standards for research outputs"
    ),

    /**
     * Source policy.
     * Rules governing what sources can be used in research.
     */
    sourcePolicy: SourcePolicySchema.describe(
      "Policy governing acceptable research sources"
    ),

    /**
     * Model and tool metadata.
     * Identifies the tools and versions used for this research run.
     */
    modelMetadata: ModelMetadataSchema.describe(
      "Model and tooling version information"
    ),
  })
  .strict();

export type ResearchConfig = z.infer<typeof ResearchConfigSchema>;
