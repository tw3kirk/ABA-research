/**
 * Topic loader and validator.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC TOPIC LOADING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module loads atomic topics with required fields:
 *   - primaryEntity: Single specific entity (e.g., "turmeric")
 *   - entityType: Classification (food, herb, ingredient, chemical, practice, habit)
 *   - claim: Object with direction (helps/harms) and optional mechanism
 *
 * VALIDATION MODES:
 *
 * 1. STRICT MODE (default for production):
 *    - Schema errors block loading immediately
 *    - Atomicity errors block topic ingestion
 *    - Use for production pipelines
 *
 * 2. LENIENT MODE (for development/migration):
 *    - Atomicity errors are collected but topics still load
 *    - Topics are tagged with `isCanonical: false` in metadata
 *    - Use for migrating legacy topics or debugging
 *
 * 3. EARLY STOP MODE:
 *    - Stop on first error encountered
 *    - Use for fast-fail validation in CI
 *
 * LOADING FUNCTIONS:
 *
 *   loadTopics()         - Returns result object with errors/warnings
 *   loadTopicsOrThrow()  - Throws on any error
 *   loadTopicArray()     - Load raw array of topics directly
 *   loadAndIndex()       - Load and return both topics and index maps
 *
 * See validators.ts for the full list of atomicity checks.
 */

import { TopicSchema, TopicCollectionSchema, type Topic, type TopicCollection } from "./schema.js";
import type { ResearchConfig } from "../config/research/schema.js";
import type { SkinCondition, ContentCategory } from "../config/research/enums.js";
import type { EntityType, ClaimDirection } from "./schema.js";
import {
  validateTopicAtomicity,
  formatValidationIssue,
  type TopicAtomicityResult,
  type TopicValidationIssue as AtomicityIssue,
} from "./validators.js";

/**
 * Validation error for topic loading.
 * Contains structured issues with suggestions and examples.
 */
export class TopicValidationError extends Error {
  public readonly issues: TopicIssue[];

  constructor(message: string, issues: TopicIssue[]) {
    super(message);
    this.name = "TopicValidationError";
    this.issues = issues;
  }

  /**
   * Format errors for display with full details.
   */
  format(): string {
    const lines = [
      "",
      "═══════════════════════════════════════════════════════════════",
      " TOPIC VALIDATION FAILED",
      "═══════════════════════════════════════════════════════════════",
      "",
    ];

    for (const issue of this.issues) {
      const location = issue.topicId ? `[${issue.topicId}]` : "[collection]";
      lines.push(`${issue.severity === "warning" ? "⚠" : "✗"} ${location} ${issue.type.toUpperCase()}`);
      lines.push(`  Field: ${issue.field}`);
      lines.push(`  Message: ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`  Suggestion: ${issue.suggestion}`);
      }
      if (issue.example) {
        lines.push(`  Example:`);
        lines.push(`    Before: ${issue.example.before}`);
        lines.push(`    After:  ${issue.example.after}`);
      }
      lines.push("");
    }

    lines.push("═══════════════════════════════════════════════════════════════");
    return lines.join("\n");
  }
}

/**
 * Individual topic validation issue with actionable feedback.
 */
export interface TopicIssue {
  /** Topic ID if applicable */
  topicId?: string;
  /** Field that has the issue */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Error type for programmatic handling */
  type: "schema" | "config_mismatch" | "duplicate" | "atomicity";
  /** Suggestion for how to fix (for atomicity issues) */
  suggestion?: string;
  /** Example of correct format */
  example?: { before: string; after: string };
  /** Severity: error blocks canonicalization, warning allows with review */
  severity?: "error" | "warning";
}

/**
 * Options for topic loading.
 */
export interface LoadTopicsOptions {
  /**
   * How to handle atomicity validation.
   * - "strict": Errors block topic loading (default)
   * - "lenient": Errors are reported but topics still load with isCanonical=false
   * - "skip": Skip atomicity validation entirely
   */
  atomicityMode?: "strict" | "lenient" | "skip";

  /**
   * Whether to include atomicity warnings in the result.
   * Default: true
   */
  includeWarnings?: boolean;

  /**
   * Stop on first error encountered.
   * Useful for fast-fail CI validation.
   * Default: false
   */
  stopOnFirstError?: boolean;

  /**
   * Maximum number of errors to collect before stopping.
   * Default: unlimited (0)
   */
  maxErrors?: number;
}

/**
 * Index maps for efficient topic lookup.
 */
export interface TopicIndexMaps {
  /** Index by skin condition */
  byCondition: Map<SkinCondition, Topic[]>;
  /** Index by content category */
  byCategory: Map<ContentCategory, Topic[]>;
  /** Index by entity type */
  byEntityType: Map<EntityType, Topic[]>;
  /** Index by claim direction */
  byClaimDirection: Map<ClaimDirection, Topic[]>;
  /** Index by topic ID */
  byId: Map<string, Topic>;
}

/**
 * Result of topic validation.
 */
export interface TopicValidationResult {
  success: boolean;
  topics?: Topic[];
  errors?: TopicIssue[];
  warnings?: TopicIssue[];
  /** Topics that passed schema but failed atomicity (only in lenient mode) */
  nonCanonicalTopics?: Topic[];
  /** Index maps for efficient lookup */
  indexes?: TopicIndexMaps;
  /** Summary statistics */
  stats?: {
    total: number;
    canonical: number;
    nonCanonical: number;
    schemaErrors: number;
    atomicityErrors: number;
    atomicityWarnings: number;
  };
  /** Whether loading was stopped early */
  stoppedEarly?: boolean;
}

/**
 * Build index maps from a list of topics.
 */
function buildIndexMaps(topics: Topic[]): TopicIndexMaps {
  const byCondition = new Map<SkinCondition, Topic[]>();
  const byCategory = new Map<ContentCategory, Topic[]>();
  const byEntityType = new Map<EntityType, Topic[]>();
  const byClaimDirection = new Map<ClaimDirection, Topic[]>();
  const byId = new Map<string, Topic>();

  for (const topic of topics) {
    // By ID
    byId.set(topic.id, topic);

    // By condition
    const condition = topic.condition as SkinCondition;
    if (!byCondition.has(condition)) {
      byCondition.set(condition, []);
    }
    byCondition.get(condition)!.push(topic);

    // By category
    const category = topic.category as ContentCategory;
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(topic);

    // By entity type
    const entityType = topic.entityType as EntityType;
    if (!byEntityType.has(entityType)) {
      byEntityType.set(entityType, []);
    }
    byEntityType.get(entityType)!.push(topic);

    // By claim direction
    const claimDirection = topic.claim.direction as ClaimDirection;
    if (!byClaimDirection.has(claimDirection)) {
      byClaimDirection.set(claimDirection, []);
    }
    byClaimDirection.get(claimDirection)!.push(topic);
  }

  return { byCondition, byCategory, byEntityType, byClaimDirection, byId };
}

/**
 * Validate that a topic's condition and category are supported by the ResearchConfig.
 */
function validateTopicConfig(topic: Topic, config: ResearchConfig): TopicIssue[] {
  const issues: TopicIssue[] = [];

  // Check condition is supported
  if (!config.supportedConditions.includes(topic.condition as SkinCondition)) {
    issues.push({
      topicId: topic.id,
      field: "condition",
      message: `Condition "${topic.condition}" is not in ResearchConfig.supportedConditions. Supported: ${config.supportedConditions.join(", ")}`,
      type: "config_mismatch",
      severity: "error",
    });
  }

  // Check category is supported
  if (!config.supportedCategories.includes(topic.category as ContentCategory)) {
    issues.push({
      topicId: topic.id,
      field: "category",
      message: `Category "${topic.category}" is not in ResearchConfig.supportedCategories. Supported: ${config.supportedCategories.join(", ")}`,
      type: "config_mismatch",
      severity: "error",
    });
  }

  return issues;
}

/**
 * Check for duplicate topic IDs.
 */
function findDuplicateIds(topics: Topic[]): TopicIssue[] {
  const seen = new Map<string, number>();
  const issues: TopicIssue[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i]!;
    const firstIndex = seen.get(topic.id);

    if (firstIndex !== undefined) {
      issues.push({
        topicId: topic.id,
        field: "id",
        message: `Duplicate topic ID "${topic.id}" (first seen at index ${firstIndex}, duplicate at index ${i})`,
        type: "duplicate",
        severity: "error",
      });
    } else {
      seen.set(topic.id, i);
    }
  }

  return issues;
}

/**
 * Convert atomicity issue to topic issue format.
 */
function convertAtomicityIssue(topicId: string, issue: AtomicityIssue): TopicIssue {
  return {
    topicId,
    field: issue.fields.join(", "),
    message: issue.message,
    type: "atomicity",
    suggestion: issue.suggestion,
    example: issue.example,
    severity: issue.severity,
  };
}

/**
 * Validate topic atomicity and return issues.
 */
function validateAtomicity(
  topic: Topic
): { errors: TopicIssue[]; warnings: TopicIssue[]; isCanonical: boolean } {
  const result = validateTopicAtomicity(topic);

  const errors: TopicIssue[] = [];
  const warnings: TopicIssue[] = [];

  for (const issue of result.issues) {
    const converted = convertAtomicityIssue(topic.id, issue);
    if (issue.severity === "error") {
      errors.push(converted);
    } else {
      warnings.push(converted);
    }
  }

  return { errors, warnings, isCanonical: result.isCanonical };
}

/**
 * Check if we should stop loading based on options and current error count.
 */
function shouldStop(options: LoadTopicsOptions, errorCount: number): boolean {
  if (options.stopOnFirstError && errorCount > 0) {
    return true;
  }
  if (options.maxErrors && options.maxErrors > 0 && errorCount >= options.maxErrors) {
    return true;
  }
  return false;
}

/**
 * Load and validate topics from a raw input object (collection format).
 *
 * @param input - Raw topic collection data { version, topics: [...] }
 * @param config - ResearchConfig to validate against
 * @param options - Loading options (atomicity mode, early stop, etc.)
 * @returns Validated topics with indexes or validation errors
 *
 * @example
 *   // Strict mode (default) - atomicity errors block loading
 *   const result = loadTopics(data, config);
 *
 *   // With early stop - fail on first error
 *   const result = loadTopics(data, config, { stopOnFirstError: true });
 *
 *   // Lenient mode - load all topics, mark non-atomic as non-canonical
 *   const result = loadTopics(data, config, { atomicityMode: "lenient" });
 */
export function loadTopics(
  input: unknown,
  config: ResearchConfig,
  options: LoadTopicsOptions = {}
): TopicValidationResult {
  const {
    atomicityMode = "strict",
    includeWarnings = true,
    stopOnFirstError = false,
    maxErrors = 0,
  } = options;

  // First, validate the collection structure
  const collectionResult = TopicCollectionSchema.safeParse(input);
  if (!collectionResult.success) {
    const issues: TopicIssue[] = collectionResult.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      message: issue.message,
      type: "schema" as const,
      severity: "error" as const,
    }));
    return { success: false, errors: issues };
  }

  const collection = collectionResult.data;
  const allErrors: TopicIssue[] = [];
  const allWarnings: TopicIssue[] = [];
  const canonicalTopics: Topic[] = [];
  const nonCanonicalTopics: Topic[] = [];

  let schemaErrors = 0;
  let atomicityErrors = 0;
  let atomicityWarnings = 0;
  let stoppedEarly = false;

  // Validate each topic
  for (const topic of collection.topics) {
    // Check if we should stop early
    if (shouldStop({ stopOnFirstError, maxErrors }, allErrors.length)) {
      stoppedEarly = true;
      break;
    }

    // Config compatibility check
    const configIssues = validateTopicConfig(topic, config);
    if (configIssues.length > 0) {
      allErrors.push(...configIssues);
      schemaErrors += configIssues.length;
      continue; // Skip atomicity check if config fails
    }

    // Atomicity validation (unless skipped)
    if (atomicityMode !== "skip") {
      const { errors, warnings, isCanonical } = validateAtomicity(topic);

      if (includeWarnings) {
        allWarnings.push(...warnings);
      }
      atomicityWarnings += warnings.length;

      if (errors.length > 0) {
        atomicityErrors += errors.length;

        if (atomicityMode === "strict") {
          allErrors.push(...errors);
        } else {
          // Lenient mode: tag topic as non-canonical
          nonCanonicalTopics.push({
            ...topic,
            metadata: {
              ...topic.metadata,
              isCanonical: false,
              atomicityErrors: errors.length,
            },
          });
        }
      } else if (isCanonical) {
        canonicalTopics.push(topic);
      } else {
        // Has warnings but no errors
        canonicalTopics.push(topic);
      }
    } else {
      // Skip atomicity validation
      canonicalTopics.push(topic);
    }
  }

  // Check for duplicate IDs across all topics (unless stopped early)
  if (!stoppedEarly) {
    const allTopics = [...canonicalTopics, ...nonCanonicalTopics];
    const duplicateIssues = findDuplicateIds(allTopics);
    allErrors.push(...duplicateIssues);
    schemaErrors += duplicateIssues.length;
  }

  // Build index maps for successful topics
  const indexes = buildIndexMaps(canonicalTopics);

  // Build result
  const stats = {
    total: collection.topics.length,
    canonical: canonicalTopics.length,
    nonCanonical: nonCanonicalTopics.length,
    schemaErrors,
    atomicityErrors,
    atomicityWarnings,
  };

  // In strict mode, any error is a failure
  if (atomicityMode === "strict" && allErrors.length > 0) {
    return {
      success: false,
      errors: allErrors,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
      stats,
      stoppedEarly,
    };
  }

  // In lenient mode, return both canonical and non-canonical topics
  return {
    success: true,
    topics: canonicalTopics,
    indexes,
    nonCanonicalTopics: nonCanonicalTopics.length > 0 ? nonCanonicalTopics : undefined,
    errors: allErrors.length > 0 ? allErrors : undefined,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
    stats,
    stoppedEarly,
  };
}

/**
 * Load and validate a raw array of topic objects directly.
 *
 * @param topics - Array of raw topic objects
 * @param config - ResearchConfig to validate against
 * @param options - Loading options
 * @returns Validated topics with indexes or validation errors
 *
 * @example
 *   const rawTopics = [
 *     { id: "turmeric_helps_redness", primaryEntity: "turmeric", ... },
 *     { id: "dairy_harms_acne", primaryEntity: "dairy", ... }
 *   ];
 *   const result = loadTopicArray(rawTopics, config);
 */
export function loadTopicArray(
  topics: unknown[],
  config: ResearchConfig,
  options: LoadTopicsOptions = {}
): TopicValidationResult {
  const {
    atomicityMode = "strict",
    includeWarnings = true,
    stopOnFirstError = false,
    maxErrors = 0,
  } = options;

  const allErrors: TopicIssue[] = [];
  const allWarnings: TopicIssue[] = [];
  const canonicalTopics: Topic[] = [];
  const nonCanonicalTopics: Topic[] = [];

  let schemaErrors = 0;
  let atomicityErrors = 0;
  let atomicityWarnings = 0;
  let stoppedEarly = false;

  // Validate each topic
  for (let i = 0; i < topics.length; i++) {
    const rawTopic = topics[i];

    // Check if we should stop early
    if (shouldStop({ stopOnFirstError, maxErrors }, allErrors.length)) {
      stoppedEarly = true;
      break;
    }

    // Schema validation
    const parseResult = TopicSchema.safeParse(rawTopic);
    if (!parseResult.success) {
      const topicId = (rawTopic as Record<string, unknown>)?.id as string | undefined;
      for (const issue of parseResult.error.issues) {
        allErrors.push({
          topicId,
          field: issue.path.join(".") || `topics[${i}]`,
          message: issue.message,
          type: "schema",
          severity: "error",
        });
        schemaErrors++;
      }
      continue;
    }

    const topic = parseResult.data;

    // Config compatibility check
    const configIssues = validateTopicConfig(topic, config);
    if (configIssues.length > 0) {
      allErrors.push(...configIssues);
      schemaErrors += configIssues.length;
      continue;
    }

    // Atomicity validation (unless skipped)
    if (atomicityMode !== "skip") {
      const { errors, warnings, isCanonical } = validateAtomicity(topic);

      if (includeWarnings) {
        allWarnings.push(...warnings);
      }
      atomicityWarnings += warnings.length;

      if (errors.length > 0) {
        atomicityErrors += errors.length;

        if (atomicityMode === "strict") {
          allErrors.push(...errors);
        } else {
          nonCanonicalTopics.push({
            ...topic,
            metadata: {
              ...topic.metadata,
              isCanonical: false,
              atomicityErrors: errors.length,
            },
          });
        }
      } else if (isCanonical) {
        canonicalTopics.push(topic);
      } else {
        canonicalTopics.push(topic);
      }
    } else {
      canonicalTopics.push(topic);
    }
  }

  // Check for duplicate IDs
  if (!stoppedEarly) {
    const allTopics = [...canonicalTopics, ...nonCanonicalTopics];
    const duplicateIssues = findDuplicateIds(allTopics);
    allErrors.push(...duplicateIssues);
    schemaErrors += duplicateIssues.length;
  }

  // Build index maps
  const indexes = buildIndexMaps(canonicalTopics);

  const stats = {
    total: topics.length,
    canonical: canonicalTopics.length,
    nonCanonical: nonCanonicalTopics.length,
    schemaErrors,
    atomicityErrors,
    atomicityWarnings,
  };

  if (atomicityMode === "strict" && allErrors.length > 0) {
    return {
      success: false,
      errors: allErrors,
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
      stats,
      stoppedEarly,
    };
  }

  return {
    success: true,
    topics: canonicalTopics,
    indexes,
    nonCanonicalTopics: nonCanonicalTopics.length > 0 ? nonCanonicalTopics : undefined,
    errors: allErrors.length > 0 ? allErrors : undefined,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
    stats,
    stoppedEarly,
  };
}

/**
 * Load and validate topics, throwing on error.
 *
 * @param input - Raw topic collection data
 * @param config - ResearchConfig to validate against
 * @param options - Loading options
 * @returns Validated canonical topics only
 * @throws TopicValidationError if validation fails
 *
 * @example
 *   try {
 *     const topics = loadTopicsOrThrow(data, config);
 *     // All topics are valid and canonical
 *   } catch (error) {
 *     if (error instanceof TopicValidationError) {
 *       console.log(error.format());
 *     }
 *   }
 */
export function loadTopicsOrThrow(
  input: unknown,
  config: ResearchConfig,
  options: LoadTopicsOptions = {}
): Topic[] {
  const result = loadTopics(input, config, options);

  if (!result.success) {
    throw new TopicValidationError(
      `Topic validation failed: ${result.errors!.length} error(s)`,
      result.errors!
    );
  }

  return result.topics!;
}

/**
 * Load topics and return both the canonical list and index maps.
 *
 * @param input - Raw topic collection data
 * @param config - ResearchConfig to validate against
 * @param options - Loading options
 * @returns Object with topics array and index maps
 * @throws TopicValidationError if validation fails
 *
 * @example
 *   const { topics, indexes } = loadAndIndex(data, config);
 *
 *   // Use indexes for efficient lookup
 *   const herbTopics = indexes.byEntityType.get("herb") ?? [];
 *   const helpfulTopics = indexes.byClaimDirection.get("helps") ?? [];
 *   const acneTopics = indexes.byCondition.get("acne_acne_scars") ?? [];
 */
export function loadAndIndex(
  input: unknown,
  config: ResearchConfig,
  options: LoadTopicsOptions = {}
): { topics: Topic[]; indexes: TopicIndexMaps } {
  const result = loadTopics(input, config, options);

  if (!result.success) {
    throw new TopicValidationError(
      `Topic validation failed: ${result.errors!.length} error(s)`,
      result.errors!
    );
  }

  return {
    topics: result.topics!,
    indexes: result.indexes!,
  };
}

/**
 * Format a detailed validation report.
 */
export function formatValidationReport(result: TopicValidationResult): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push(" Topic Validation Report");
  lines.push("═══════════════════════════════════════════════════════════════");

  if (result.stats) {
    lines.push("");
    lines.push(`Total Topics:       ${result.stats.total}`);
    lines.push(`Canonical:          ${result.stats.canonical}`);
    lines.push(`Non-Canonical:      ${result.stats.nonCanonical}`);
    lines.push(`Schema Errors:      ${result.stats.schemaErrors}`);
    lines.push(`Atomicity Errors:   ${result.stats.atomicityErrors}`);
    lines.push(`Atomicity Warnings: ${result.stats.atomicityWarnings}`);
    if (result.stoppedEarly) {
      lines.push(`(Stopped early - more errors may exist)`);
    }
  }

  if (result.errors && result.errors.length > 0) {
    lines.push("");
    lines.push("───────────────────────────────────────────────────────────────");
    lines.push(" ERRORS (block ingestion)");
    lines.push("───────────────────────────────────────────────────────────────");

    for (const error of result.errors) {
      lines.push("");
      lines.push(`✗ [${error.topicId || "collection"}] ${error.type.toUpperCase()}`);
      lines.push(`  Field: ${error.field}`);
      lines.push(`  Message: ${error.message}`);
      if (error.suggestion) {
        lines.push(`  Suggestion: ${error.suggestion}`);
      }
      if (error.example) {
        lines.push(`  Example:`);
        lines.push(`    Before: ${error.example.before}`);
        lines.push(`    After:  ${error.example.after}`);
      }
    }
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push("");
    lines.push("───────────────────────────────────────────────────────────────");
    lines.push(" WARNINGS (review recommended)");
    lines.push("───────────────────────────────────────────────────────────────");

    for (const warning of result.warnings) {
      lines.push("");
      lines.push(`⚠ [${warning.topicId || "collection"}] ${warning.type.toUpperCase()}`);
      lines.push(`  Field: ${warning.field}`);
      lines.push(`  Message: ${warning.message}`);
      if (warning.suggestion) {
        lines.push(`  Suggestion: ${warning.suggestion}`);
      }
    }
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push(result.success ? " ✓ Validation PASSED" : " ✗ Validation FAILED");
  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}
