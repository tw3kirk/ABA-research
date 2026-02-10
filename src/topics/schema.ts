/**
 * Topic schema and type definitions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC TOPIC CONSTRAINT — CRITICAL FOR CONTENT GENERATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each topic MUST represent ONE atomic research claim that can support:
 *   - A single research paper
 *   - A single email
 *   - A single YouTube script
 *   - A single SEO blog post
 *
 * REQUIRED STRUCTURE:
 *   1. Single Primary Entity — ONE specific thing (e.g., "turmeric", "avocado")
 *   2. Single Claim Direction — Either HELPS or HARMS skin
 *   3. Single Skin Condition — From the canonical 4 conditions
 *   4. Single Research Category — From the canonical 10 categories
 *
 * PROHIBITED PATTERNS (will fail validation):
 *   ✗ Lists of entities: "turmeric, ginger, and ashwagandha"
 *   ✗ Bucket categories: "Ayurvedic herbs for acne"
 *   ✗ Multiple mechanisms: "reduces inflammation and balances hormones"
 *   ✗ Vague entities: "certain foods", "some chemicals", "various herbs"
 *   ✗ Compound entities: "fruits and vegetables"
 *
 * VALID EXAMPLES:
 *   ✓ "turmeric" + "reduces" + "redness_hyperpigmentation"
 *   ✓ "retinol" + "improves" + "acne_acne_scars"
 *   ✓ "dairy" + "worsens" + "acne_acne_scars"
 *
 * ═══════════════════════════════════════════════════════════════════════════
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
  "active", // Ready for research
  "draft", // Still being defined
  "archived", // No longer active but preserved
  "suspended", // Temporarily disabled
]);
export type TopicStatus = z.infer<typeof TopicStatus>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLAIM DIRECTION — Mandatory directional assertion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every topic must assert a SINGLE direction of effect.
 * This enforces that research has a clear thesis to investigate.
 *
 * "helps"   → The entity has beneficial effects on the skin condition
 * "harms"   → The entity has detrimental effects on the skin condition
 */
export const ClaimDirection = z.enum(["helps", "harms"]);
export type ClaimDirection = z.infer<typeof ClaimDirection>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ENTITY TYPE — Classification of the primary entity
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Categorizes what kind of thing the primary entity is.
 * Helps downstream content generation use appropriate framing.
 */
export const EntityType = z.enum([
  "food", // Edible item (avocado, kale, dairy)
  "herb", // Plant used medicinally (turmeric, ashwagandha)
  "ingredient", // Skincare/cosmetic ingredient (retinol, lanolin)
  "chemical", // Synthetic compound (parabens, sulfates)
  "practice", // Behavioral/lifestyle practice (oil pulling, dry brushing)
  "habit", // Daily habit (touching face, sleeping late)
]);
export type EntityType = z.infer<typeof EntityType>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLAIM SCHEMA — The core research assertion
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Encapsulates the directional claim and optional mechanism.
 * The mechanism should describe HOW the entity affects the condition.
 */
export const ClaimSchema = z.object({
  /**
   * Direction of the claim: does this entity help or harm?
   * This is MANDATORY — every topic must take a position.
   */
  direction: ClaimDirection,

  /**
   * The specific mechanism by which the entity affects the condition.
   * Should be a single, specific mechanism — not a list.
   *
   * GOOD: "reduces sebum production"
   * GOOD: "provides anti-inflammatory polyphenols"
   * BAD:  "reduces inflammation and balances hormones" (multiple mechanisms)
   */
  mechanism: z
    .string()
    .min(10, "Mechanism must be descriptive (min 10 chars)")
    .max(200, "Mechanism should be concise (max 200 chars)")
    .refine(
      (val) => !val.includes(" and ") || val.split(" and ").length <= 2,
      "Mechanism should describe a single effect, not multiple mechanisms joined by 'and'"
    )
    .optional(),

  /**
   * Confidence level in the claim based on available evidence.
   * Used to prioritize research and set appropriate hedging in content.
   */
  confidence: z.enum(["established", "emerging", "preliminary"]).default("preliminary"),
});
export type Claim = z.infer<typeof ClaimSchema>;

/**
 * Patterns that indicate a non-atomic entity (lists, plurals suggesting groups).
 * Used to reject bucket categories during validation.
 */
const PROHIBITED_ENTITY_PATTERNS = [
  /\band\b/i, // "turmeric and ginger"
  /,\s*\w+/, // "turmeric, ginger"
  /\bvarious\b/i, // "various herbs"
  /\bcertain\b/i, // "certain foods"
  /\bsome\b/i, // "some chemicals"
  /\bmany\b/i, // "many ingredients"
  /\bseveral\b/i, // "several practices"
  /\bmultiple\b/i, // "multiple herbs"
  /\bdifferent\b/i, // "different foods"
  /\bother\b/i, // "other practices" (bucket)
  /\betc\.?$/i, // "herbs, spices, etc."
];

/**
 * Validates that an entity name represents a SINGLE, specific thing.
 */
function isAtomicEntity(entity: string): boolean {
  // Check for prohibited patterns
  for (const pattern of PROHIBITED_ENTITY_PATTERNS) {
    if (pattern.test(entity)) {
      return false;
    }
  }

  // Entity should be reasonably short (single item, not a description)
  const wordCount = entity.trim().split(/\s+/).length;
  if (wordCount > 4) {
    return false; // "organic cold-pressed coconut oil" is OK, but longer is suspect
  }

  return true;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOPIC SCHEMA — The atomic research unit
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each topic is a complete, atomic research specification.
 * It identifies ONE entity, ONE claim, ONE condition, ONE category.
 *
 * This schema enforces atomicity through:
 *   1. Required primaryEntity field with validation
 *   2. Required claim object with direction
 *   3. Refinements that reject non-atomic patterns
 */
export const TopicSchema = z
  .object({
    /**
     * Unique identifier for the topic.
     * Must be stable across runs for deterministic indexing.
     *
     * Convention: {entity}_{direction}_{condition_abbrev}
     * Example: "turmeric_helps_redness", "dairy_harms_acne"
     */
    id: z
      .string()
      .min(1)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "Topic ID must be lowercase alphanumeric with underscores, starting with a letter"
      ),

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * PRIMARY ENTITY — The single thing being researched
     * ═══════════════════════════════════════════════════════════════════════
     *
     * This is the MOST IMPORTANT field for atomicity.
     * Must be ONE specific, named entity — not a category or list.
     *
     * VALID:   "turmeric", "avocado", "retinol", "dairy", "dry brushing"
     * INVALID: "Ayurvedic herbs", "various foods", "turmeric and ginger"
     */
    primaryEntity: z
      .string()
      .min(2, "Entity name too short")
      .max(50, "Entity name too long — should be a single item")
      .refine(isAtomicEntity, {
        message:
          "Entity must be a single, specific item. Avoid lists (and, commas), " +
          "vague terms (various, certain, some), or bucket categories.",
      }),

    /**
     * Type classification of the primary entity.
     * Guides content generation framing and research approach.
     */
    entityType: EntityType,

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * CLAIM — The directional research assertion
     * ═══════════════════════════════════════════════════════════════════════
     *
     * Every topic MUST have a claim with a direction.
     * This is what makes research actionable and content focused.
     */
    claim: ClaimSchema,

    /**
     * Human-readable name for the topic.
     * Should clearly state the entity and claim direction.
     *
     * GOOD: "Turmeric Reduces Skin Redness"
     * BAD:  "Ayurvedic Herbs for Skin" (bucket category)
     */
    name: z
      .string()
      .min(5)
      .max(100)
      .refine(
        (val) => !val.toLowerCase().includes("foods that") && !val.toLowerCase().includes("herbs that"),
        "Name should not be a bucket category. Use a specific entity name."
      ),

    /**
     * Detailed description of the specific research claim.
     * Should explain the single mechanism being investigated.
     */
    description: z
      .string()
      .min(20, "Description must explain the specific claim")
      .max(500)
      .optional(),

    /**
     * The skin condition this topic addresses.
     * Must be ONE condition from the canonical 4.
     */
    condition: SkinCondition,

    /**
     * The content category for this topic.
     * Must be ONE category from the canonical 10.
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
     * Should NOT contain entity lists or bucket descriptions.
     */
    tags: z.array(z.string().max(30)).max(5).default([]),

    /**
     * Optional metadata for extensibility.
     * Pipelines may use this for topic-specific configuration.
     */
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (topic) => {
      // Validate that claim direction aligns with category semantics
      const harmCategories = [
        "animal_ingredients_in_food_that_harm_skin",
        "animal_ingredients_in_skincare_that_harm_skin",
        "other_foods_that_harm_skin",
        "skincare_chemicals_that_harm_skin",
        "habits_that_harm_skin",
      ];
      const helpCategories = [
        "vegan_foods_that_help_skin",
        "ayurvedic_herbs_in_skincare_that_help_skin",
        "ayurvedic_practices_that_help_skin",
        "other_practices_that_help_skin",
        "ayurvedic_herbs_to_eat_that_benefit_skin",
      ];

      if (harmCategories.includes(topic.category)) {
        return topic.claim.direction === "harms";
      }
      if (helpCategories.includes(topic.category)) {
        return topic.claim.direction === "helps";
      }
      return true;
    },
    {
      message:
        "Claim direction must align with category: 'harm' categories require direction='harms', " +
        "'help' categories require direction='helps'",
    }
  );

export type Topic = z.infer<typeof TopicSchema>;

/**
 * Schema for a collection of topics.
 * Used when loading from JSON files.
 */
export const TopicCollectionSchema = z.object({
  /**
   * Schema version for migration support.
   * Bump minor version when adding optional fields.
   * Bump major version when changing required fields or validation.
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/),

  /**
   * Collection of topics.
   * Each topic must pass atomic validation independently.
   */
  topics: z.array(TopicSchema),

  /**
   * Optional: Examples of INVALID topics for documentation.
   * These are NOT validated — they exist to show what fails.
   * Each should include an 'invalidReason' explaining the failure.
   */
  invalidExamples: z
    .array(
      z.object({
        example: z.record(z.string(), z.unknown()),
        invalidReason: z.string(),
      })
    )
    .optional(),
});

export type TopicCollection = z.infer<typeof TopicCollectionSchema>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOPIC GENERATION CONSTRAINTS — For LLM/automated generators
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When generating new topics programmatically, enforce these rules:
 *
 * 1. SINGLE ENTITY RULE
 *    - Extract ONE specific entity from research
 *    - If source mentions multiple, create separate topics for each
 *    - Never combine entities into one topic
 *
 * 2. SINGLE CLAIM RULE
 *    - Each topic asserts ONE direction (helps OR harms)
 *    - If an entity has mixed effects, create separate topics
 *    - Never hedge with "may help or harm"
 *
 * 3. SINGLE MECHANISM RULE
 *    - The claim.mechanism should describe ONE pathway
 *    - If multiple mechanisms exist, pick the primary one
 *    - Or create separate topics for each mechanism
 *
 * 4. SPECIFICITY RULE
 *    - "turmeric" not "spices"
 *    - "retinol" not "vitamin A derivatives"
 *    - "cow's milk" not "dairy products"
 *
 * 5. ACTIONABILITY RULE
 *    - Reader should know exactly what to do/avoid
 *    - "eat turmeric" or "avoid dairy"
 *    - Not "consider various dietary changes"
 */
