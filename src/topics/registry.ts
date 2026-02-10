/**
 * Topic registry with deterministic indexing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISTIC INDEXING FOR ATOMIC TOPICS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The TopicRegistry is the central access point for all topic data during
 * pipeline execution. It provides:
 *
 * 1. DETERMINISTIC INDEXING: Topics are indexed by multiple dimensions:
 *    - Skin condition (redness, dryness, oily, acne)
 *    - Content category (10 canonical categories)
 *    - Entity type (food, herb, ingredient, chemical, practice, habit)
 *    - Claim direction (helps, harms)
 *    - Condition + Category combination
 *
 * 2. EFFICIENT LOOKUP: O(1) access to topics by various dimensions, enabling
 *    pipelines to efficiently filter and batch work.
 *
 * 3. IMMUTABILITY: Once created, the registry cannot be modified, ensuring
 *    pipeline stages see consistent data throughout execution.
 *
 * CONSUMPTION PATTERNS:
 *
 * - By Entity Type: Get all "herb" topics for herbal content series
 * - By Claim Direction: Separate "helps" vs "harms" for content tone
 * - By Condition: Group all topics for a skin condition
 * - By Category: Generate category-specific content formats
 * - Combined filters: Complex queries for specific content needs
 */

import type { Topic, TopicPriority, TopicStatus, ClaimDirection, EntityType } from "./schema.js";
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
 * All filters are AND-combined (topics must match all specified criteria).
 */
export interface TopicFilter {
  /** Filter by skin condition */
  condition?: SkinCondition;
  /** Filter by content category */
  category?: ContentCategory;
  /** Filter by entity type (food, herb, ingredient, etc.) */
  entityType?: EntityType;
  /** Filter by claim direction (helps or harms) */
  claimDirection?: ClaimDirection;
  /** Filter by priority level */
  priority?: TopicPriority;
  /** Filter by status */
  status?: TopicStatus;
  /** Filter by any of these tags (OR within tags) */
  tags?: string[];
  /** Filter by primary entity (partial match, case-insensitive) */
  entityContains?: string;
}

/**
 * Statistics about the registry contents.
 */
export interface RegistryStats {
  totalTopics: number;
  byStatus: Record<TopicStatus, number>;
  byPriority: Record<TopicPriority, number>;
  byEntityType: Record<EntityType, number>;
  byClaimDirection: Record<ClaimDirection, number>;
  uniqueConditions: number;
  uniqueCategories: number;
  uniqueCombinations: number;
}

/**
 * Immutable topic registry with deterministic indexes.
 *
 * @example
 *   const registry = TopicRegistry.create(topics);
 *
 *   // Get all herb topics
 *   const herbs = registry.getByEntityType("herb");
 *
 *   // Get all "harms" topics for acne
 *   const harmful = registry.filter({
 *     condition: "acne_acne_scars",
 *     claimDirection: "harms"
 *   });
 *
 *   // Get all food topics that help skin
 *   const helpfulFoods = registry.filter({
 *     entityType: "food",
 *     claimDirection: "helps"
 *   });
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

  /**
   * Index: entityType -> topics (sorted by ID).
   */
  private readonly _byEntityType: ReadonlyMap<EntityType, ReadonlyArray<Readonly<Topic>>>;

  /**
   * Index: claim direction -> topics (sorted by ID).
   */
  private readonly _byClaimDirection: ReadonlyMap<ClaimDirection, ReadonlyArray<Readonly<Topic>>>;

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
    this._byEntityType = this.buildEntityTypeIndex(this._topics);
    this._byClaimDirection = this.buildClaimDirectionIndex(this._topics);
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

  private buildEntityTypeIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<EntityType, ReadonlyArray<Readonly<Topic>>> {
    const index = new Map<EntityType, Topic[]>();

    for (const topic of topics) {
      const entityType = topic.entityType as EntityType;
      if (!index.has(entityType)) {
        index.set(entityType, []);
      }
      index.get(entityType)!.push(topic);
    }

    // Freeze arrays and return
    const frozenIndex = new Map<EntityType, ReadonlyArray<Readonly<Topic>>>();
    for (const [key, value] of index) {
      frozenIndex.set(key, Object.freeze(value));
    }
    return frozenIndex;
  }

  private buildClaimDirectionIndex(
    topics: ReadonlyArray<Readonly<Topic>>
  ): ReadonlyMap<ClaimDirection, ReadonlyArray<Readonly<Topic>>> {
    const index = new Map<ClaimDirection, Topic[]>();

    for (const topic of topics) {
      const direction = topic.claim.direction as ClaimDirection;
      if (!index.has(direction)) {
        index.set(direction, []);
      }
      index.get(direction)!.push(topic);
    }

    // Freeze arrays and return
    const frozenIndex = new Map<ClaimDirection, ReadonlyArray<Readonly<Topic>>>();
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
   * Get all topics for an entity type (sorted by ID).
   *
   * @param entityType - Entity type (food, herb, ingredient, etc.)
   * @returns Topics for that entity type, or empty array
   *
   * @example
   *   const herbTopics = registry.getByEntityType("herb");
   *   const foodTopics = registry.getByEntityType("food");
   */
  getByEntityType(entityType: EntityType): ReadonlyArray<Readonly<Topic>> {
    return this._byEntityType.get(entityType) ?? [];
  }

  /**
   * Get all topics by claim direction (sorted by ID).
   *
   * @param direction - Claim direction ("helps" or "harms")
   * @returns Topics for that direction, or empty array
   *
   * @example
   *   const beneficial = registry.getByClaimDirection("helps");
   *   const harmful = registry.getByClaimDirection("harms");
   */
  getByClaimDirection(direction: ClaimDirection): ReadonlyArray<Readonly<Topic>> {
    return this._byClaimDirection.get(direction) ?? [];
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
   * Get all unique entity types that have topics.
   */
  getEntityTypes(): ReadonlyArray<EntityType> {
    return Object.freeze([...this._byEntityType.keys()].sort());
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
   * All criteria are AND-combined (topics must match all).
   *
   * @param filter - Filter options
   * @returns Filtered topics
   *
   * @example
   *   // Get all high-priority herb topics that help acne
   *   const topics = registry.filter({
   *     entityType: "herb",
   *     claimDirection: "helps",
   *     condition: "acne_acne_scars",
   *     priority: "high"
   *   });
   */
  filter(filter: TopicFilter): ReadonlyArray<Readonly<Topic>> {
    let results = [...this._topics];

    if (filter.condition !== undefined) {
      results = results.filter((t) => t.condition === filter.condition);
    }

    if (filter.category !== undefined) {
      results = results.filter((t) => t.category === filter.category);
    }

    if (filter.entityType !== undefined) {
      results = results.filter((t) => t.entityType === filter.entityType);
    }

    if (filter.claimDirection !== undefined) {
      results = results.filter((t) => t.claim.direction === filter.claimDirection);
    }

    if (filter.priority !== undefined) {
      results = results.filter((t) => t.priority === filter.priority);
    }

    if (filter.status !== undefined) {
      results = results.filter((t) => t.status === filter.status);
    }

    if (filter.tags !== undefined && filter.tags.length > 0) {
      const requiredTags = new Set(filter.tags);
      results = results.filter((t) => t.tags.some((tag) => requiredTags.has(tag)));
    }

    if (filter.entityContains !== undefined) {
      const search = filter.entityContains.toLowerCase();
      results = results.filter((t) => t.primaryEntity.toLowerCase().includes(search));
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
    const byEntityType: Record<string, number> = {
      food: 0,
      herb: 0,
      ingredient: 0,
      chemical: 0,
      practice: 0,
      habit: 0,
    };
    const byClaimDirection: Record<string, number> = {
      helps: 0,
      harms: 0,
    };

    for (const topic of this._topics) {
      byStatus[topic.status]++;
      byPriority[topic.priority]++;
      byEntityType[topic.entityType]++;
      byClaimDirection[topic.claim.direction]++;
    }

    return {
      totalTopics: this._topics.length,
      byStatus: byStatus as Record<TopicStatus, number>,
      byPriority: byPriority as Record<TopicPriority, number>,
      byEntityType: byEntityType as Record<EntityType, number>,
      byClaimDirection: byClaimDirection as Record<ClaimDirection, number>,
      uniqueConditions: this._byCondition.size,
      uniqueCategories: this._byCategory.size,
      uniqueCombinations: this._byConditionAndCategory.size,
    };
  }
}
