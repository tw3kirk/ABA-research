/**
 * Topic loader and validator.
 *
 * Responsible for:
 * - Loading topics from various sources (JSON for now)
 * - Validating topic schema
 * - Validating compatibility with ResearchConfig
 * - Validating atomicity constraints (single entity, single claim)
 * - Producing actionable error messages with suggestions
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMICITY VALIDATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Topics must be ATOMIC to be marked as canonical. The loader runs atomicity
 * validation and can operate in two modes:
 *
 * 1. STRICT MODE (default for production):
 *    - Atomicity errors block topic ingestion
 *    - Topics with errors are not returned
 *    - Use for production pipelines
 *
 * 2. LENIENT MODE (for development/migration):
 *    - Atomicity errors are collected but topics still load
 *    - Topics are tagged with `isCanonical: false` in metadata
 *    - Use for migrating legacy topics or debugging
 *
 * See validators.ts for the full list of atomicity checks.
 */

import { TopicSchema, TopicCollectionSchema, type Topic, type TopicCollection } from "./schema.js";
import type { ResearchConfig } from "../config/research/schema.js";
import type { SkinCondition, ContentCategory } from "../config/research/enums.js";
import {
  validateTopicAtomicity,
  formatValidationIssue,
  type TopicAtomicityResult,
  type TopicValidationIssue as AtomicityIssue,
} from "./validators.js";

/**
 * Validation error for topic loading.
 */
export class TopicValidationError extends Error {
  public readonly issues: TopicIssue[];

  constructor(message: string, issues: TopicIssue[]) {
    super(message);
    this.name = "TopicValidationError";
    this.issues = issues;
  }

  /**
   * Format errors for display.
   */
  format(): string {
    const lines = ["Topic validation failed:"];
    for (const issue of this.issues) {
      const location = issue.topicId ? `[${issue.topicId}]` : "[collection]";
      lines.push(`  - ${location} ${issue.field}: ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`    SUGGESTION: ${issue.suggestion}`);
      }
      if (issue.example) {
        lines.push(`    EXAMPLE: ${issue.example.before} → ${issue.example.after}`);
      }
    }
    return lines.join("\n");
  }
}

/**
 * Individual topic validation issue.
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
  /** Summary statistics */
  stats?: {
    total: number;
    canonical: number;
    nonCanonical: number;
    schemaErrors: number;
    atomicityErrors: number;
    atomicityWarnings: number;
  };
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
    });
  }

  // Check category is supported
  if (!config.supportedCategories.includes(topic.category as ContentCategory)) {
    issues.push({
      topicId: topic.id,
      field: "category",
      message: `Category "${topic.category}" is not in ResearchConfig.supportedCategories. Supported: ${config.supportedCategories.join(", ")}`,
      type: "config_mismatch",
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
 * Load and validate topics from a raw input object.
 *
 * @param input - Raw topic collection data
 * @param config - ResearchConfig to validate against
 * @param options - Loading options (atomicity mode, etc.)
 * @returns Validated topics or validation errors
 *
 * @example
 *   // Strict mode (default) - atomicity errors block loading
 *   const result = loadTopics(data, config);
 *
 *   // Lenient mode - load all topics, mark non-atomic as non-canonical
 *   const result = loadTopics(data, config, { atomicityMode: "lenient" });
 */
export function loadTopics(
  input: unknown,
  config: ResearchConfig,
  options: LoadTopicsOptions = {}
): TopicValidationResult {
  const { atomicityMode = "strict", includeWarnings = true } = options;

  // First, validate the collection structure
  const collectionResult = TopicCollectionSchema.safeParse(input);
  if (!collectionResult.success) {
    const issues: TopicIssue[] = collectionResult.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(root)",
      message: issue.message,
      type: "schema" as const,
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

  // Validate each topic
  for (const topic of collection.topics) {
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

  // Check for duplicate IDs across all topics
  const allTopics = [...canonicalTopics, ...nonCanonicalTopics];
  const duplicateIssues = findDuplicateIds(allTopics);
  allErrors.push(...duplicateIssues);
  schemaErrors += duplicateIssues.length;

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
    };
  }

  // In lenient mode, return both canonical and non-canonical topics
  return {
    success: true,
    topics: canonicalTopics,
    nonCanonicalTopics: nonCanonicalTopics.length > 0 ? nonCanonicalTopics : undefined,
    errors: allErrors.length > 0 ? allErrors : undefined,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
    stats,
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
 * Format a detailed validation report.
 */
export function formatValidationReport(result: TopicValidationResult): string {
  const lines: string[] = [];

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
  }

  if (result.errors && result.errors.length > 0) {
    lines.push("");
    lines.push("───────────────────────────────────────────────────────────────");
    lines.push(" ERRORS (block ingestion)");
    lines.push("───────────────────────────────────────────────────────────────");

    for (const error of result.errors) {
      lines.push("");
      lines.push(`[${error.topicId || "collection"}] ${error.type.toUpperCase()}`);
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
      lines.push(`[${warning.topicId || "collection"}] ${warning.type.toUpperCase()}`);
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
