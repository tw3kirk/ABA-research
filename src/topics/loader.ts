/**
 * Topic loader and validator.
 *
 * Responsible for:
 * - Loading topics from various sources (JSON for now)
 * - Validating topic schema
 * - Validating compatibility with ResearchConfig
 * - Producing actionable error messages
 */

import { z } from "zod";
import { TopicSchema, TopicCollectionSchema, type Topic, type TopicCollection } from "./schema.js";
import type { ResearchConfig } from "../config/research/schema.js";
import type { SkinCondition, ContentCategory } from "../config/research/enums.js";

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
  type: "schema" | "config_mismatch" | "duplicate";
}

/**
 * Result of topic validation.
 */
export interface TopicValidationResult {
  success: boolean;
  topics?: Topic[];
  errors?: TopicIssue[];
}

/**
 * Validate a single topic against its schema.
 */
function validateTopicSchema(input: unknown, index: number): TopicIssue[] {
  const result = TopicSchema.safeParse(input);
  if (result.success) {
    return [];
  }

  return result.error.issues.map((issue) => ({
    topicId: (input as Record<string, unknown>)?.id as string | undefined,
    field: issue.path.join(".") || `topics[${index}]`,
    message: issue.message,
    type: "schema" as const,
  }));
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
    const topic = topics[i];
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
 * Load and validate topics from a raw input object.
 *
 * @param input - Raw topic collection data
 * @param config - ResearchConfig to validate against
 * @returns Validated topics or validation errors
 */
export function loadTopics(
  input: unknown,
  config: ResearchConfig
): TopicValidationResult {
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
  const allIssues: TopicIssue[] = [];

  // Validate each topic's schema (already done by Zod, but we can add custom checks)
  // Validate against ResearchConfig
  for (const topic of collection.topics) {
    const configIssues = validateTopicConfig(topic, config);
    allIssues.push(...configIssues);
  }

  // Check for duplicate IDs
  const duplicateIssues = findDuplicateIds(collection.topics);
  allIssues.push(...duplicateIssues);

  if (allIssues.length > 0) {
    return { success: false, errors: allIssues };
  }

  return { success: true, topics: collection.topics };
}

/**
 * Load and validate topics, throwing on error.
 *
 * @param input - Raw topic collection data
 * @param config - ResearchConfig to validate against
 * @returns Validated topics
 * @throws TopicValidationError if validation fails
 */
export function loadTopicsOrThrow(input: unknown, config: ResearchConfig): Topic[] {
  const result = loadTopics(input, config);

  if (!result.success) {
    throw new TopicValidationError(
      `Topic validation failed: ${result.errors!.length} error(s)`,
      result.errors!
    );
  }

  return result.topics!;
}
