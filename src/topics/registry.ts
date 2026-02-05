/**
 * Topic registry with deterministic indexing.
 *
 * The TopicRegistry is the central access point for all topic data during
 * pipeline execution. It provides:
 *
 * 1. DETERMINISTIC INDEXING: Topics are indexed by condition, category, and
 *    their combination. Indexes are sorted alphabetically to ensure consistent
 *    ordering across runs, which is critical for reproducibility.
 *
 * 2. EFFICIENT LOOKUP: O(1) access to topics by various dimensions, enabling
 *    pipelines to efficiently filter and batch work.
 *
 * 3. IMMUTABILITY: Once created, the registry cannot be modified, ensuring
 *    pipeline stages see consistent data throughout execution.
 *
 * FUTURE CONSUMPTION PATTERNS:
 *
 * - Pipeline Orchestrator: Will iterate over topics by priority, dispatching
 *   research tasks. The byCondition index enables condition-focused batching.
 *
 * - Content Generator: Will use byCategory to generate category-appropriate
 *   content formats (e.g., all "treatment_options" topics get similar structure).
 *
 * - Research Aggregator: Will use byConditionAndCategory to merge related
 *   research outputs into comprehensive documents.
 *
 * - Progress Tracker: Will use the flat topics list to track completion status
 *   and estimate remaining work.
 */

import type { Topic, TopicPriority, TopicStatus } from "./schema.js";
import type { SkinCondition, ContentCategory } from "../config/research/enums.js";

/**
 * Composite key for condition + category index.
 * Format: "{condition}:{category}"
 */
export type ConditionCategoryKey = `${SkinCondition}:${ContentCategory}`;

/**
 * Create a composite key for condition + category indexing.
 */
export function makeConditionCategoryKey(
  condition: SkinCondition,
  category: ContentCategory
): ConditionCategoryKey {
  return `${condition}:${category}`;
}

/**
 * Parse a composite key back into condition and category.
 */
export function parseConditionCategoryKey(key: ConditionCategoryKey): {
  condition: SkinCondition;
  category: ContentCategory;
} {
  const [condition, category] = key.split(":") as [SkinCondition, ContentCategory];
  return { condition, category };
}

/**
 * Topic filter options for querying the registry.
 */
export interface TopicFilter {
  condition?: SkinCondition;
  category?: ContentCategory;
  priority?: TopicPriority;
  status?: TopicStatus;
  tags?: string[];
}

/**
 * Statistics about the registry contents.
 */
export interface RegistryStats {
  totalTopics: number;
  byStatus: Record<TopicStatus, number>;
  byPriority: Record<TopicPriority, number>;
  uniqueConditions: number;
  uniqueCategories: number;
  uniqueCombinations: number;
}

/**
 * Immutable topic registry with deterministic indexes.
 */
export class TopicRegistry {
  /**
   * All topics, sorted by ID for deterministic iteration.
   */
  private readonly _topics: ReadonlyArray<Readonly<Topic>>;

  /**
   * Index: condition -> topics (sorted by ID).
   */
  private readonly _byCondition: ReadonlyMap<SkinCondition, ReadonlyArray<Readonly<Topic>>>;

  /**
   * Index: category -> topics (sorted by ID).
   */
  private readonly _byCategory: ReadonlyMap<ContentCategory, ReadonlyArray<Readonly<Topic>>>;

  /**
   * Index: condition:category -> topics (sorted by ID).
   */
  private readonly _byConditionAndCategory: ReadonlyMap<
    ConditionCategoryKey,
    ReadonlyArray<Readonly<Topic>>
  >;

  /**
   * Index: topic ID -> topic (for direct lookup).
   */
  private readonly _byId: ReadonlyMap<string, Readonly<Topic>>;

  private constructor(topics: Topic[]) {
    // Sort topics by ID for deterministic ordering
    const sortedTopics = [...topics].sort((a, b) => a.id.localeCompare(b.id));

    // Deep freeze all topics
    this._topics = Object.freeze(sortedTopics.map((t) => Object.freeze({ ...t })));

    // Build indexes
    this._byId = this.buildIdIndex(this._topics);
    this._byCondition = this.buildConditionIndex(this._topics);
    this._byCategory = this.buildCategoryIndex(this._topics);
    this._byConditionAndCategory = this.buildConditionCategoryIndex(this._topics);
  }

  /**
   * Create a new TopicRegistry from validated topics.
   *
   * @param topics - Validated topics (from loader)
   * @returns Immutable TopicRegistry
   */
  static create(topics: Topic[]): TopicRegistry {
    return new TopicRegistry(topics);
  }

  // ============================================================
  // Index Builders (private)
  // ============================================================

  private buildIdIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<string, Readonly<Topic>> {
    const index = new Map<string, Readonly<Topic>>();
    for (const topic of topics) {
      index.set(topic.id, topic);
    }
    return index;
  }

  private buildConditionIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<SkinCondition, ReadonlyArray<Readonly<Topic>>> {
    const index = new Map<SkinCondition, Topic[]>();

    for (const topic of topics) {
      const condition = topic.condition as SkinCondition;
      if (!index.has(condition)) {
        index.set(condition, []);
      }
      index.get(condition)!.push(topic);
    }

    // Freeze arrays and return
    const frozenIndex = new Map<SkinCondition, ReadonlyArray<Readonly<Topic>>>();
    for (const [key, value] of index) {
      frozenIndex.set(key, Object.freeze(value));
    }
    return frozenIndex;
  }

  private buildCategoryIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<ContentCategory, ReadonlyArray<Readonly<Topic>>> {
    const index = new Map<ContentCategory, Topic[]>();

    for (const topic of topics) {
      const category = topic.category as ContentCategory;
      if (!index.has(category)) {
        index.set(category, []);
      }
      index.get(category)!.push(topic);
    }

    // Freeze arrays and return
    const frozenIndex = new Map<ContentCategory, ReadonlyArray<Readonly<Topic>>>();
    for (const [key, value] of index) {
      frozenIndex.set(key, Object.freeze(value));
    }
    return frozenIndex;
  }

  private buildConditionCategoryIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<ConditionCategoryKey, ReadonlyArray<Readonly<Topic>>> {
    const index = new Map<ConditionCategoryKey, Topic[]>();

    for (const topic of topics) {
      const key = makeConditionCategoryKey(
        topic.condition as SkinCondition,
        topic.category as ContentCategory
      );
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(topic);
    }

    // Freeze arrays and return
    const frozenIndex = new Map<ConditionCategoryKey, ReadonlyArray<Readonly<Topic>>>();
    for (const [key, value] of index) {
      frozenIndex.set(key, Object.freeze(value));
    }
    return frozenIndex;
  }

  // ============================================================
  // Public Accessors
  // ============================================================

  /**
   * Get all topics (sorted by ID).
   */
  get topics(): ReadonlyArray<Readonly<Topic>> {
    return this._topics;
  }

  /**
   * Get topic by ID.
   *
   * @param id - Topic ID
   * @returns Topic or undefined if not found
   */
  getById(id: string): Readonly<Topic> | undefined {
    return this._byId.get(id);
  }

  /**
   * Get all topics for a condition (sorted by ID).
   *
   * @param condition - Skin condition
   * @returns Topics for that condition, or empty array
   */
  getByCondition(condition: SkinCondition): ReadonlyArray<Readonly<Topic>> {
    return this._byCondition.get(condition) ?? [];
  }

  /**
   * Get all topics for a category (sorted by ID).
   *
   * @param category - Content category
   * @returns Topics for that category, or empty array
   */
  getByCategory(category: ContentCategory): ReadonlyArray<Readonly<Topic>> {
    return this._byCategory.get(category) ?? [];
  }

  /**
   * Get all topics for a condition + category combination (sorted by ID).
   *
   * @param condition - Skin condition
   * @param category - Content category
   * @returns Topics for that combination, or empty array
   */
  getByConditionAndCategory(
    condition: SkinCondition,
    category: ContentCategory
  ): ReadonlyArray<Readonly<Topic>> {
    const key = makeConditionCategoryKey(condition, category);
    return this._byConditionAndCategory.get(key) ?? [];
  }

  /**
   * Get all unique conditions that have topics.
   */
  getConditions(): ReadonlyArray<SkinCondition> {
    return Object.freeze([...this._byCondition.keys()].sort());
  }

  /**
   * Get all unique categories that have topics.
   */
  getCategories(): ReadonlyArray<ContentCategory> {
    return Object.freeze([...this._byCategory.keys()].sort());
  }

  /**
   * Get all unique condition + category combinations.
   */
  getConditionCategoryKeys(): ReadonlyArray<ConditionCategoryKey> {
    return Object.freeze([...this._byConditionAndCategory.keys()].sort());
  }

  /**
   * Filter topics by multiple criteria.
   * Results are sorted by ID for determinism.
   *
   * @param filter - Filter options
   * @returns Filtered topics
   */
  filter(filter: TopicFilter): ReadonlyArray<Readonly<Topic>> {
    let results = [...this._topics];

    if (filter.condition !== undefined) {
      results = results.filter((t) => t.condition === filter.condition);
    }

    if (filter.category !== undefined) {
      results = results.filter((t) => t.category === filter.category);
    }

    if (filter.priority !== undefined) {
      results = results.filter((t) => t.priority === filter.priority);
    }

    if (filter.status !== undefined) {
      results = results.filter((t) => t.status === filter.status);
    }

    if (filter.tags !== undefined && filter.tags.length > 0) {
      const requiredTags = new Set(filter.tags);
      results = results.filter((t) =>
        t.tags.some((tag) => requiredTags.has(tag))
      );
    }

    return Object.freeze(results);
  }

  /**
   * Get statistics about the registry.
   */
  getStats(): RegistryStats {
    const byStatus: Record<string, number> = {
      active: 0,
      draft: 0,
      archived: 0,
      suspended: 0,
    };
    const byPriority: Record<string, number> = {
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const topic of this._topics) {
      byStatus[topic.status]++;
      byPriority[topic.priority]++;
    }

    return {
      totalTopics: this._topics.length,
      byStatus: byStatus as Record<TopicStatus, number>,
      byPriority: byPriority as Record<TopicPriority, number>,
      uniqueConditions: this._byCondition.size,
      uniqueCategories: this._byCategory.size,
      uniqueCombinations: this._byConditionAndCategory.size,
    };
  }
}
