/**
 * Topic-aware content constraints.
 *
 * Derives per-topic content constraints from atomic topic fields
 * (primaryEntity, claim.direction, condition) and normalizes them
 * against content standards and SEO guidelines.
 *
 * DESIGN:
 *
 * 1. DERIVATION: For each atomic topic, produces an SEO target phrase,
 *    email subject intent, and blog keyword set tied to the topic's
 *    specific entity + condition + direction.
 *
 * 2. NORMALIZATION: Generic guideline rules are resolved against actual
 *    topic fields. Rules that reference entities or conditions not
 *    present in the topic set are rejected.
 *
 * 3. CONTRADICTION DETECTION: SEO guidelines (keyword density, meta title
 *    length, spacing) are checked against each topic's derived keyword
 *    shape. Clear errors are produced when the guidelines are structurally
 *    incompatible with a topic's constraints.
 *
 * INTEGRATION:
 *
 *   const result = deriveTopicConstraints(topics, contentStandards, seoGuidelines);
 *   if (!result.success) {
 *     for (const issue of result.issues) { ... }
 *   }
 *   for (const c of result.constraints) {
 *     // c.seo.targetPhrase    → "kale redness"
 *     // c.email.subjectIntent → "how kale helps reduce skin redness"
 *     // c.blog.keywordSet     → ["kale redness", "kale", "redness", ...]
 *   }
 */

import { z } from "zod";
import { SkinCondition } from "../config/research/enums.js";
import { ClaimDirection, type Topic } from "../topics/schema.js";
import type { ContentStandards } from "./content-schema.js";
import type { SeoGuidelines } from "./seo-schema.js";

// ---------------------------------------------------------------------------
// Condition name mappings
// ---------------------------------------------------------------------------

/**
 * Short keyword-friendly names for each canonical skin condition.
 * Used to construct SEO target phrases.
 */
const CONDITION_SHORT_NAMES: Readonly<Record<string, string>> = {
  redness_hyperpigmentation: "redness",
  dryness_premature_aging: "dry skin",
  oily_skin: "oily skin",
  acne_acne_scars: "acne",
};

/**
 * Longer display names used in email subject intents and descriptive phrases.
 */
const CONDITION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  redness_hyperpigmentation: "skin redness",
  dryness_premature_aging: "dry skin and premature aging",
  oily_skin: "oily skin",
  acne_acne_scars: "acne and acne scars",
};

// ---------------------------------------------------------------------------
// Guideline rule schema — optional per-entity / per-condition overrides
// ---------------------------------------------------------------------------

/**
 * A custom guideline rule that targets topics matching specific
 * entity, condition, and/or direction criteria.
 *
 * At least one targeting field (entity, condition, direction) is required.
 * Overrides are applied on top of the automatically derived constraints.
 */
export const GuidelineRuleSchema = z
  .object({
    /** Match topics whose primaryEntity equals this value (case-insensitive). */
    entity: z.string().min(1).optional(),

    /** Match topics targeting this skin condition. */
    condition: SkinCondition.optional(),

    /** Match topics with this claim direction. */
    direction: ClaimDirection.optional(),

    /** SEO overrides for matching topics. */
    seo: z
      .object({
        primaryKeywordOverride: z
          .string()
          .min(1)
          .optional()
          .describe("Replace the auto-derived primary keyword"),
        additionalKeywords: z
          .array(z.string().min(1))
          .optional()
          .describe("Extra secondary keywords to merge in"),
      })
      .strict()
      .optional(),

    /** Email overrides for matching topics. */
    email: z
      .object({
        subjectIntentOverride: z
          .string()
          .min(1)
          .optional()
          .describe("Replace the auto-derived email subject intent"),
      })
      .strict()
      .optional(),

    /** Blog overrides for matching topics. */
    blog: z
      .object({
        additionalKeywords: z
          .array(z.string().min(1))
          .optional()
          .describe("Extra blog keywords to merge in"),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.entity !== undefined ||
      data.condition !== undefined ||
      data.direction !== undefined,
    "GuidelineRule must target at least one of: entity, condition, direction"
  );

export type GuidelineRule = z.infer<typeof GuidelineRuleSchema>;

// ---------------------------------------------------------------------------
// Per-topic content constraints
// ---------------------------------------------------------------------------

/**
 * Content constraints derived for a single atomic topic.
 *
 * Every field is deterministically derived from the topic's atomic fields
 * (primaryEntity, claim.direction, condition) normalized against the
 * content standards and SEO guidelines.
 */
export interface TopicContentConstraints {
  /** The topic ID these constraints belong to. */
  topicId: string;

  /** The topic's primary entity (verbatim). */
  primaryEntity: string;

  /** The topic's claim direction. */
  claimDirection: "helps" | "harms";

  /** The topic's skin condition. */
  condition: string;

  /** SEO constraints derived from topic shape. */
  seo: {
    /** The combined entity + condition phrase (e.g. "kale redness"). */
    targetPhrase: string;
    /** The primary keyword to optimize for. */
    primaryKeyword: string;
    /** Additional keywords derived from entity, condition, direction. */
    secondaryKeywords: string[];
  };

  /** Email constraints derived from topic shape. */
  email: {
    /** Descriptive intent for email subject lines. */
    subjectIntent: string;
  };

  /** Blog constraints derived from topic shape. */
  blog: {
    /** Full keyword set (primary + secondary, deduplicated, sorted). */
    keywordSet: string[];
  };
}

// ---------------------------------------------------------------------------
// Issue reporting
// ---------------------------------------------------------------------------

/**
 * A single issue detected during constraint derivation or validation.
 */
export interface ConstraintIssue {
  /** Whether this blocks constraint generation. */
  type: "error" | "warning";
  /** Index of the guideline rule that caused this issue (if applicable). */
  rule?: number;
  /** Topic ID involved (if applicable). */
  topicId?: string;
  /** Dot-path to the problematic field. */
  field: string;
  /** Human-readable explanation. */
  message: string;
  /** Machine-readable issue code. */
  code: string;
}

/**
 * Result of the constraint derivation process.
 */
export interface TopicConstraintsResult {
  /** True when no errors were found (warnings are allowed). */
  success: boolean;
  /** Per-topic constraints (empty when success is false). */
  constraints: ReadonlyArray<Readonly<TopicContentConstraints>>;
  /** All issues encountered during derivation. */
  issues: ReadonlyArray<Readonly<ConstraintIssue>>;
}

// ---------------------------------------------------------------------------
// Guideline rule validation
// ---------------------------------------------------------------------------

/**
 * Validate guideline rules against the topic set.
 *
 * Rejects rules that:
 * - Reference an entity not present in any topic's primaryEntity
 * - Reference a condition that no topic targets
 * - Specify a direction that contradicts the actual topic direction
 * - Provide SEO keyword overrides that omit the target entity
 * - Provide SEO keyword overrides that omit the target condition
 */
function validateGuidelineRules(
  rules: GuidelineRule[],
  topics: readonly Topic[]
): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];

  const validEntities = new Set(
    topics.map((t) => t.primaryEntity.toLowerCase())
  );
  const activeConditions = new Set(topics.map((t) => t.condition));

  // Map entity+condition → direction for contradiction detection
  const directionMap = new Map<string, string>();
  for (const topic of topics) {
    directionMap.set(
      `${topic.primaryEntity.toLowerCase()}::${topic.condition}`,
      topic.claim.direction
    );
  }

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];

    // --- entity must match a topic ---
    if (rule.entity !== undefined) {
      if (!validEntities.has(rule.entity.toLowerCase())) {
        issues.push({
          type: "error",
          rule: i,
          field: "entity",
          message:
            `GuidelineRule[${i}] references entity "${rule.entity}" which does not match ` +
            `any topic's primaryEntity. Valid entities: ${[...validEntities].sort().join(", ")}`,
          code: "invalid_entity_reference",
        });
      }
    }

    // --- condition should be used by at least one topic ---
    if (rule.condition !== undefined && !activeConditions.has(rule.condition)) {
      issues.push({
        type: "warning",
        rule: i,
        field: "condition",
        message:
          `GuidelineRule[${i}] references condition "${rule.condition}" ` +
          `which is a valid SkinCondition but no topics currently target it`,
        code: "unused_condition_reference",
      });
    }

    // --- direction must not contradict actual topic ---
    if (
      rule.entity !== undefined &&
      rule.condition !== undefined &&
      rule.direction !== undefined
    ) {
      const key = `${rule.entity.toLowerCase()}::${rule.condition}`;
      const actual = directionMap.get(key);
      if (actual !== undefined && actual !== rule.direction) {
        issues.push({
          type: "error",
          rule: i,
          field: "direction",
          message:
            `GuidelineRule[${i}] specifies direction "${rule.direction}" but topic ` +
            `"${rule.entity}" + "${rule.condition}" has direction "${actual}"`,
          code: "direction_contradiction",
        });
      }
    }

    // --- SEO keyword override must include entity ---
    if (
      rule.seo?.primaryKeywordOverride !== undefined &&
      rule.entity !== undefined
    ) {
      const keyword = rule.seo.primaryKeywordOverride.toLowerCase();
      const entity = rule.entity.toLowerCase();
      if (!keyword.includes(entity)) {
        issues.push({
          type: "error",
          rule: i,
          field: "seo.primaryKeywordOverride",
          message:
            `GuidelineRule[${i}] SEO keyword override "${rule.seo.primaryKeywordOverride}" ` +
            `does not contain the target entity "${rule.entity}". ` +
            `SEO target phrase must reference the topic's primary entity.`,
          code: "seo_entity_mismatch",
        });
      }
    }

    // --- SEO keyword override should include condition ---
    if (
      rule.seo?.primaryKeywordOverride !== undefined &&
      rule.condition !== undefined
    ) {
      const keyword = rule.seo.primaryKeywordOverride.toLowerCase();
      const condShort = CONDITION_SHORT_NAMES[rule.condition]?.toLowerCase();
      if (condShort && !keyword.includes(condShort)) {
        issues.push({
          type: "warning",
          rule: i,
          field: "seo.primaryKeywordOverride",
          message:
            `GuidelineRule[${i}] SEO keyword override "${rule.seo.primaryKeywordOverride}" ` +
            `does not reference condition "${rule.condition}" (short: "${condShort}"). ` +
            `Consider including the condition for better SEO alignment.`,
          code: "seo_condition_mismatch",
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// SEO ↔ topic shape validation
// ---------------------------------------------------------------------------

/**
 * Detect contradictions between SEO guidelines and a specific topic's
 * derived keyword shape.
 *
 * Checks:
 * - Keyword density feasibility (can the phrase appear at all?)
 * - Spacing vs. density conflicts
 * - Meta title length vs. keyword length
 */
function validateSeoTopicAlignment(
  topic: Topic,
  targetPhrase: string,
  seoGuidelines: Readonly<SeoGuidelines>
): ConstraintIssue[] {
  const issues: ConstraintIssue[] = [];
  const phraseWordCount = targetPhrase.split(/\s+/).length;
  const minContentWords = seoGuidelines.contentLength.wordCount.min;
  const maxContentWords = seoGuidelines.contentLength.wordCount.max;
  const maxDensity = seoGuidelines.keywordDensity.primaryKeyword.max;
  const minDensity = seoGuidelines.keywordDensity.primaryKeyword.min;
  const minSpacing = seoGuidelines.keywordDensity.minKeywordSpacing;

  // --- Can the keyword appear even once at max density? ---
  const maxOccurrences = Math.floor(
    (maxDensity / 100) * (minContentWords / phraseWordCount)
  );
  if (maxOccurrences < 1) {
    issues.push({
      type: "error",
      topicId: topic.id,
      field: "seo.keywordDensity",
      message:
        `Topic "${topic.id}" target phrase "${targetPhrase}" (${phraseWordCount} words) ` +
        `cannot appear even once within ${minContentWords} min words at ` +
        `${maxDensity}% max density. The SEO density ceiling is too low for this keyword length.`,
      code: "seo_density_impossible",
    });
  }

  // --- Min density achievable given spacing constraint? ---
  if (minSpacing > 0) {
    const minOccurrencesNeeded = Math.ceil(
      (minDensity / 100) * (maxContentWords / phraseWordCount)
    );
    const maxOccurrencesBySpacing =
      Math.floor(maxContentWords / minSpacing) + 1;
    if (minOccurrencesNeeded > maxOccurrencesBySpacing) {
      issues.push({
        type: "error",
        topicId: topic.id,
        field: "seo.keywordDensity",
        message:
          `Topic "${topic.id}" requires at least ${minOccurrencesNeeded} keyword occurrences ` +
          `for ${minDensity}% density, but min spacing of ${minSpacing} words only allows ` +
          `${maxOccurrencesBySpacing} in ${maxContentWords} words`,
        code: "seo_spacing_density_conflict",
      });
    }
  }

  // --- Meta title long enough to hold the keyword? ---
  if (seoGuidelines.metaContent.titleContainsKeyword) {
    const maxTitleChars = seoGuidelines.metaContent.titleLength.max;
    if (targetPhrase.length > maxTitleChars) {
      issues.push({
        type: "error",
        topicId: topic.id,
        field: "seo.metaContent.titleLength",
        message:
          `Topic "${topic.id}" target phrase "${targetPhrase}" ` +
          `(${targetPhrase.length} chars) exceeds max meta title length ` +
          `(${maxTitleChars} chars), but title is required to contain the keyword`,
        code: "seo_title_keyword_overflow",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Constraint derivation
// ---------------------------------------------------------------------------

/**
 * Find guideline rules whose targeting criteria match a given topic.
 */
function findMatchingRules(
  topic: Topic,
  rules: GuidelineRule[]
): GuidelineRule[] {
  return rules.filter((rule) => {
    if (
      rule.entity !== undefined &&
      rule.entity.toLowerCase() !== topic.primaryEntity.toLowerCase()
    ) {
      return false;
    }
    if (rule.condition !== undefined && rule.condition !== topic.condition) {
      return false;
    }
    if (
      rule.direction !== undefined &&
      rule.direction !== topic.claim.direction
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Derive content constraints for a single topic.
 *
 * Builds SEO target phrase, email subject intent, and blog keyword set
 * from the topic's atomic fields, then applies any matching guideline
 * rule overrides.
 */
function deriveConstraintsForTopic(
  topic: Topic,
  contentStandards: Readonly<ContentStandards>,
  matchingRules: GuidelineRule[]
): TopicContentConstraints {
  const conditionShort =
    CONDITION_SHORT_NAMES[topic.condition] ?? topic.condition;
  const conditionDisplay =
    CONDITION_DISPLAY_NAMES[topic.condition] ?? topic.condition;
  const entityLower = topic.primaryEntity.toLowerCase();

  // --- SEO target phrase: entity + condition short name ---
  let primaryKeyword = `${entityLower} ${conditionShort}`;
  let targetPhrase = primaryKeyword;

  // --- Secondary keywords from atomic fields ---
  const secondaryKeywords = new Set<string>([
    entityLower,
    conditionShort,
    `${entityLower} for ${conditionShort}`,
    `${entityLower} skin ${conditionShort}`,
  ]);

  // Entity-type-aware keywords
  if (topic.entityType === "herb") {
    secondaryKeywords.add(`${entityLower} herb for skin`);
  } else if (topic.entityType === "food") {
    secondaryKeywords.add(`${entityLower} for skin`);
  } else if (topic.entityType === "practice") {
    secondaryKeywords.add(`${entityLower} skin benefits`);
  }

  // Direction-aware keywords
  if (topic.claim.direction === "helps") {
    secondaryKeywords.add(`${entityLower} benefits for ${conditionShort}`);
    secondaryKeywords.add(`${entityLower} helps ${conditionShort}`);
  } else {
    secondaryKeywords.add(`${entityLower} causes ${conditionShort}`);
    secondaryKeywords.add(`${entityLower} ${conditionShort} effects`);
  }

  // Brand-aware keywords: emphasize brand topics when aligned
  for (const emphasis of contentStandards.brand.emphasize) {
    const lower = emphasis.toLowerCase();
    if (lower.includes(topic.entityType) || lower.includes("plant-based")) {
      if (topic.entityType === "herb" || topic.entityType === "food") {
        secondaryKeywords.add(`natural ${entityLower} for ${conditionShort}`);
      }
    }
  }

  // --- Email subject intent ---
  let subjectIntent: string;
  if (topic.claim.direction === "helps") {
    subjectIntent = `how ${entityLower} helps reduce ${conditionDisplay}`;
  } else {
    subjectIntent = `how ${entityLower} may worsen ${conditionDisplay}`;
  }

  // --- Apply matching guideline rule overrides ---
  for (const rule of matchingRules) {
    if (rule.seo?.primaryKeywordOverride) {
      primaryKeyword = rule.seo.primaryKeywordOverride;
      targetPhrase = rule.seo.primaryKeywordOverride;
    }
    if (rule.seo?.additionalKeywords) {
      for (const kw of rule.seo.additionalKeywords) {
        secondaryKeywords.add(kw.toLowerCase());
      }
    }
    if (rule.email?.subjectIntentOverride) {
      subjectIntent = rule.email.subjectIntentOverride;
    }
    if (rule.blog?.additionalKeywords) {
      for (const kw of rule.blog.additionalKeywords) {
        secondaryKeywords.add(kw.toLowerCase());
      }
    }
  }

  // Remove primary keyword from secondary set to avoid duplication
  secondaryKeywords.delete(primaryKeyword);

  const sortedSecondary = [...secondaryKeywords].sort();

  return {
    topicId: topic.id,
    primaryEntity: topic.primaryEntity,
    claimDirection: topic.claim.direction,
    condition: topic.condition,
    seo: {
      targetPhrase,
      primaryKeyword,
      secondaryKeywords: sortedSecondary,
    },
    email: {
      subjectIntent,
    },
    blog: {
      keywordSet: [primaryKeyword, ...sortedSecondary],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive per-topic content constraints from atomic topics, content standards,
 * and SEO guidelines.
 *
 * For each topic, produces:
 * - **SEO target phrase** from `primaryEntity` + `condition` (e.g. "kale redness")
 * - **Email subject intent** from `primaryEntity` + `claim.direction` + `condition`
 * - **Blog keyword set** combining entity, condition, direction, and entity-type keywords
 *
 * Normalizes guideline rules against actual topic fields and validates that:
 * - Custom rules reference entities present in the topic set
 * - Custom rules reference conditions present in the topic set
 * - Direction overrides do not contradict actual topic direction
 * - SEO keyword overrides reference the target entity
 * - SEO guideline parameters (density, spacing, meta title) are achievable
 *   for each topic's derived keyword shape
 *
 * @param topics - Validated atomic topics
 * @param contentStandards - Loaded content standards
 * @param seoGuidelines - Loaded SEO guidelines
 * @param guidelineRules - Optional custom rules for per-entity/condition overrides
 * @returns Result with per-topic constraints and any validation issues
 */
export function deriveTopicConstraints(
  topics: readonly Topic[],
  contentStandards: Readonly<ContentStandards>,
  seoGuidelines: Readonly<SeoGuidelines>,
  guidelineRules?: unknown[]
): TopicConstraintsResult {
  const issues: ConstraintIssue[] = [];

  if (topics.length === 0) {
    issues.push({
      type: "error",
      field: "topics",
      message: "Cannot derive constraints from an empty topic set",
      code: "empty_topics",
    });
    return { success: false, constraints: [], issues };
  }

  // --- Parse and validate custom guideline rules ---
  let parsedRules: GuidelineRule[] = [];
  if (guidelineRules && guidelineRules.length > 0) {
    for (let i = 0; i < guidelineRules.length; i++) {
      const result = GuidelineRuleSchema.safeParse(guidelineRules[i]);
      if (!result.success) {
        for (const zodIssue of result.error.issues) {
          issues.push({
            type: "error",
            rule: i,
            field: zodIssue.path.join(".") || "(root)",
            message: `GuidelineRule[${i}] schema validation failed: ${zodIssue.message}`,
            code: "invalid_rule_schema",
          });
        }
      } else {
        parsedRules.push(result.data);
      }
    }

    // Bail early if any rules failed schema validation
    if (issues.some((i) => i.code === "invalid_rule_schema")) {
      return { success: false, constraints: [], issues };
    }

    // Validate rules reference valid entities / conditions
    const ruleIssues = validateGuidelineRules(parsedRules, topics);
    issues.push(...ruleIssues);

    // Bail early on rule validation errors (warnings are OK)
    if (ruleIssues.some((i) => i.type === "error")) {
      return { success: false, constraints: [], issues };
    }
  }

  // --- Derive constraints for each topic ---
  const constraints: TopicContentConstraints[] = [];

  for (const topic of topics) {
    // Derive the target phrase first so SEO validation can reference it
    const conditionShort =
      CONDITION_SHORT_NAMES[topic.condition] ?? topic.condition;
    const targetPhrase =
      `${topic.primaryEntity.toLowerCase()} ${conditionShort}`;

    // Check SEO guidelines are compatible with this topic's keyword shape
    const seoIssues = validateSeoTopicAlignment(
      topic,
      targetPhrase,
      seoGuidelines
    );
    issues.push(...seoIssues);

    // Skip constraint derivation for topics with SEO errors
    if (seoIssues.some((i) => i.type === "error")) {
      continue;
    }

    const matchingRules = findMatchingRules(topic, parsedRules);
    const topicConstraints = deriveConstraintsForTopic(
      topic,
      contentStandards,
      matchingRules
    );
    constraints.push(topicConstraints);
  }

  const hasErrors = issues.some((i) => i.type === "error");
  return {
    success: !hasErrors,
    constraints,
    issues,
  };
}

/**
 * Format constraint issues into a human-readable report.
 */
export function formatConstraintIssues(issues: readonly ConstraintIssue[]): string {
  if (issues.length === 0) return "No issues found.";

  const errors = issues.filter((i) => i.type === "error");
  const warnings = issues.filter((i) => i.type === "warning");
  const lines: string[] = [];

  lines.push(`Topic constraint issues: ${errors.length} error(s), ${warnings.length} warning(s)`);
  lines.push("");

  if (errors.length > 0) {
    lines.push("ERRORS:");
    for (const err of errors) {
      const prefix = err.topicId
        ? `  [${err.topicId}]`
        : err.rule !== undefined
          ? `  [rule ${err.rule}]`
          : "  ";
      lines.push(`${prefix} ${err.field}: ${err.message} (${err.code})`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const warn of warnings) {
      const prefix = warn.topicId
        ? `  [${warn.topicId}]`
        : warn.rule !== undefined
          ? `  [rule ${warn.rule}]`
          : "  ";
      lines.push(`${prefix} ${warn.field}: ${warn.message} (${warn.code})`);
    }
  }

  return lines.join("\n");
}
