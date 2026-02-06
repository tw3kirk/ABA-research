/**
 * Research specification factory.
 *
 * Creates immutable research specifications that serve as the canonical
 * input contract for all pipeline stages.
 *
 * USAGE IN PIPELINE STAGES:
 *
 * The specification flows through the pipeline as follows:
 *
 * 1. INITIALIZATION: Created once at run start with all inputs validated
 *
 * 2. RESEARCH STAGE: Uses spec.topics to determine what to research,
 *    spec.researchConfig.qualityRequirements for citation standards,
 *    spec.researchConfig.sourcePolicy for source selection
 *
 * 3. CONTENT GENERATION: Uses spec.researchConfig.allowedOutputFormats
 *    to determine valid output types, spec.topics for content structure
 *
 * 4. OUTPUT STAGE: Uses spec.runMetadata.runId for file naming,
 *    serializes full spec for audit trail
 *
 * 5. AUDIT/REPLAY: Deserializes spec from disk to reproduce exact run
 */

import type { ResearchConfig } from "../config/research/schema.js";
import type { Topic } from "../topics/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";
import type { SeoGuidelines } from "../standards/seo-schema.js";
import {
  type ResearchSpecification,
  type TopicSummary,
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
 * Create topic summaries for quick reference.
 */
function createTopicSummaries(topics: Topic[]): TopicSummary[] {
  return topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    condition: topic.condition,
    category: topic.category,
    priority: topic.priority,
    status: topic.status,
  }));
}

/**
 * Compute specification statistics.
 */
function computeStats(topics: Topic[]): ResearchSpecification["stats"] {
  const activeTopics = topics.filter((t) => t.status === "active");
  const conditions = new Set(topics.map((t) => t.condition));
  const categories = new Set(topics.map((t) => t.category));

  return {
    totalTopics: topics.length,
    activeTopics: activeTopics.length,
    uniqueConditions: conditions.size,
    uniqueCategories: categories.size,
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

  // Build the specification
  const spec: ResearchSpecification = {
    specificationVersion: SPECIFICATION_VERSION,
    runMetadata,
    researchConfig: options.researchConfig,
    topics: sortedTopics,
    topicSummaries: createTopicSummaries(sortedTopics),
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
