/**
 * Topic schema and type definitions.
 *
 * Topics are the fundamental unit of research organization. Each topic
 * represents a specific intersection of:
 * - A skin condition (what we're researching)
 * - A content category (the lens through which we research it)
 *
 * Topics are configuration, not content. They define WHAT to research,
 * not the research itself. The actual research content will be generated
 * by pipelines that consume topics from the registry.
 */

import { z } from "zod";
import { SkinCondition, ContentCategory } from "../config/research/enums.js";

/**
 * Topic priority levels.
 * Used for ordering and filtering during pipeline execution.
 */
export const TopicPriority = z.enum(["high", "medium", "low"]);
export type TopicPriority = z.infer<typeof TopicPriority>;

/**
 * Topic status for lifecycle management.
 */
export const TopicStatus = z.enum([
  "active",      // Ready for research
  "draft",       // Still being defined
  "archived",    // No longer active but preserved
  "suspended",   // Temporarily disabled
]);
export type TopicStatus = z.infer<typeof TopicStatus>;

/**
 * Schema for a single research topic.
 *
 * Topics are intentionally lightweight - they identify what to research,
 * not how to research it. Pipeline configuration handles the "how".
 */
export const TopicSchema = z
  .object({
    /**
     * Unique identifier for the topic.
     * Must be stable across runs for deterministic indexing.
     * Convention: {condition}_{category}_{variant} (e.g., "acne_treatment_options_topical")
     */
    id: z
      .string()
      .min(1)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "Topic ID must be lowercase alphanumeric with underscores, starting with a letter"
      ),

    /**
     * Human-readable name for the topic.
     */
    name: z.string().min(1),

    /**
     * Detailed description of what this topic covers.
     */
    description: z.string().optional(),

    /**
     * The skin condition this topic addresses.
     * Must be a valid condition from ResearchConfig.supportedConditions.
     */
    condition: SkinCondition,

    /**
     * The content category for this topic.
     * Must be a valid category from ResearchConfig.supportedCategories.
     */
    category: ContentCategory,

    /**
     * Priority for processing order.
     */
    priority: TopicPriority.default("medium"),

    /**
     * Current status of the topic.
     */
    status: TopicStatus.default("active"),

    /**
     * Tags for additional filtering and organization.
     */
    tags: z.array(z.string()).default([]),

    /**
     * Optional metadata for extensibility.
     * Pipelines may use this for topic-specific configuration.
     */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type Topic = z.infer<typeof TopicSchema>;

/**
 * Schema for a collection of topics.
 * Used when loading from JSON files.
 */
export const TopicCollectionSchema = z.object({
  /**
   * Schema version for migration support.
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),

  /**
   * Collection of topics.
   */
  topics: z.array(TopicSchema),
});

export type TopicCollection = z.infer<typeof TopicCollectionSchema>;
