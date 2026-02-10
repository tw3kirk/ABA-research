/**
 * Topic Atomicity Validators
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * VALIDATION GUARDRAILS FOR ATOMIC TOPIC ENFORCEMENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These validators ensure topics conform to the atomic topic constraint:
 * ONE entity + ONE claim + ONE condition + ONE category.
 *
 * VALIDATION DOES NOT CRASH — it returns structured issues that:
 *   1. Explain WHY the topic failed
 *   2. Provide SUGGESTIONS for how to fix it
 *   3. Show EXAMPLES of correct rewrites
 *
 * Topics that fail validation are NOT marked as canonical and cannot
 * proceed through the ingestion pipeline until corrected.
 *
 * USAGE:
 *   const result = validateTopicAtomicity(topic);
 *   if (!result.isValid) {
 *     for (const issue of result.issues) {
 *       console.log(formatValidationIssue(issue));
 *     }
 *   }
 */

import type { Topic } from "./schema.js";

/**
 * Severity levels for validation issues.
 * - error: Topic cannot be ingested; must be fixed
 * - warning: Topic can be ingested but should be reviewed
 */
export type ValidationSeverity = "error" | "warning";

/**
 * Validation rule identifiers for programmatic handling.
 */
export type ValidationRule =
  | "MULTIPLE_ENTITIES"
  | "PLURAL_WITHOUT_SPECIFIC"
  | "BUCKET_PHRASE"
  | "VAGUE_QUANTIFIER"
  | "MULTIPLE_CLAIMS"
  | "LIST_IN_NAME"
  | "LIST_IN_DESCRIPTION"
  | "COMPOUND_ENTITY"
  | "GENERIC_CATEGORY_NAME";

/**
 * A structured validation issue with actionable feedback.
 */
export interface TopicValidationIssue {
  /** Unique rule identifier */
  rule: ValidationRule;

  /** Severity: error blocks ingestion, warning allows with review */
  severity: ValidationSeverity;

  /** Human-readable explanation of the problem */
  message: string;

  /** Specific reason this topic failed */
  reason: string;

  /** Actionable suggestion for how to fix */
  suggestion: string;

  /** Example of a correct rewrite */
  example?: {
    before: string;
    after: string;
  };

  /** Which field(s) triggered this issue */
  fields: Array<keyof Topic | "claim.mechanism">;
}

/**
 * Result of validating a topic's atomicity.
 */
export interface TopicAtomicityResult {
  /** Whether the topic passes all validation rules */
  isValid: boolean;

  /** Whether the topic can be ingested (no errors, warnings OK) */
  isCanonical: boolean;

  /** All issues found during validation */
  issues: TopicValidationIssue[];

  /** Count of errors (block ingestion) */
  errorCount: number;

  /** Count of warnings (allow with review) */
  warningCount: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns that indicate multiple entities (lists).
 */
const MULTIPLE_ENTITY_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\band\b/i, description: "conjunction 'and'" },
  { pattern: /,\s*\w+/i, description: "comma-separated list" },
  { pattern: /\bor\b/i, description: "conjunction 'or'" },
  { pattern: /\bas well as\b/i, description: "phrase 'as well as'" },
  { pattern: /\balong with\b/i, description: "phrase 'along with'" },
  { pattern: /\bplus\b/i, description: "conjunction 'plus'" },
  { pattern: /\b&\b/, description: "ampersand '&'" },
];

/**
 * Bucket phrases that indicate non-atomic topics.
 * These are category-level descriptions, not specific entities.
 */
const BUCKET_PHRASES: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bfoods?\s+that\b/i, description: "'foods that...'" },
  { pattern: /\bthings?\s+that\b/i, description: "'things that...'" },
  { pattern: /\bherbs?\s+that\b/i, description: "'herbs that...'" },
  { pattern: /\bingredients?\s+that\b/i, description: "'ingredients that...'" },
  { pattern: /\bpractices?\s+that\b/i, description: "'practices that...'" },
  { pattern: /\bhabits?\s+that\b/i, description: "'habits that...'" },
  { pattern: /\bchemicals?\s+that\b/i, description: "'chemicals that...'" },
  { pattern: /\bsubstances?\s+that\b/i, description: "'substances that...'" },
  { pattern: /\bproducts?\s+that\b/i, description: "'products that...'" },
  { pattern: /\bfoods?\s+for\b/i, description: "'foods for...'" },
  { pattern: /\bherbs?\s+for\b/i, description: "'herbs for...'" },
  { pattern: /\bways?\s+to\b/i, description: "'ways to...'" },
  { pattern: /\bmethods?\s+to\b/i, description: "'methods to...'" },
];

/**
 * Vague quantifiers that suggest non-specific entities.
 */
const VAGUE_QUANTIFIERS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bvarious\b/i, description: "'various'" },
  { pattern: /\bcertain\b/i, description: "'certain'" },
  { pattern: /\bsome\b/i, description: "'some'" },
  { pattern: /\bmany\b/i, description: "'many'" },
  { pattern: /\bseveral\b/i, description: "'several'" },
  { pattern: /\bmultiple\b/i, description: "'multiple'" },
  { pattern: /\bdifferent\b/i, description: "'different'" },
  { pattern: /\bnumerous\b/i, description: "'numerous'" },
  { pattern: /\bspecific\b/i, description: "'specific' (ironically vague)" },
  { pattern: /\bkey\b/i, description: "'key'" },
  { pattern: /\btop\b/i, description: "'top'" },
  { pattern: /\bbest\b/i, description: "'best'" },
];

/**
 * Common plural nouns that should be singular specific entities.
 */
const PLURAL_BUCKET_NOUNS: Array<{ pattern: RegExp; singular: string }> = [
  { pattern: /\bfoods\b/i, singular: "food" },
  { pattern: /\bherbs\b/i, singular: "herb" },
  { pattern: /\bspices\b/i, singular: "spice" },
  { pattern: /\bvegetables\b/i, singular: "vegetable" },
  { pattern: /\bfruits\b/i, singular: "fruit" },
  { pattern: /\bnuts\b/i, singular: "nut" },
  { pattern: /\bseeds\b/i, singular: "seed" },
  { pattern: /\boils\b/i, singular: "oil" },
  { pattern: /\bingredients\b/i, singular: "ingredient" },
  { pattern: /\bchemicals\b/i, singular: "chemical" },
  { pattern: /\bpractices\b/i, singular: "practice" },
  { pattern: /\bhabits\b/i, singular: "habit" },
  { pattern: /\broutines\b/i, singular: "routine" },
  { pattern: /\bproducts\b/i, singular: "product" },
  { pattern: /\bsupplements\b/i, singular: "supplement" },
  { pattern: /\bvitamins\b/i, singular: "vitamin" },
  { pattern: /\bminerals\b/i, singular: "mineral" },
  { pattern: /\bantioxidants\b/i, singular: "antioxidant" },
];

/**
 * Compound terms that should be split into separate topics.
 */
const COMPOUND_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\bfruits?\s+and\s+vegetables?\b/i, description: "'fruits and vegetables'" },
  { pattern: /\bnuts?\s+and\s+seeds?\b/i, description: "'nuts and seeds'" },
  { pattern: /\bherbs?\s+and\s+spices?\b/i, description: "'herbs and spices'" },
  { pattern: /\bvitamins?\s+and\s+minerals?\b/i, description: "'vitamins and minerals'" },
  { pattern: /\bdiet\s+and\s+exercise\b/i, description: "'diet and exercise'" },
  { pattern: /\bdiet\s+and\s+lifestyle\b/i, description: "'diet and lifestyle'" },
];

// ═══════════════════════════════════════════════════════════════════════════
// INDIVIDUAL VALIDATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check for multiple entities in the primaryEntity field.
 */
function checkMultipleEntities(topic: Topic): TopicValidationIssue | null {
  const entity = topic.primaryEntity;

  for (const { pattern, description } of MULTIPLE_ENTITY_PATTERNS) {
    if (pattern.test(entity)) {
      // Extract the entities mentioned
      const parts = entity.split(/\s*(?:,|and|or|&|\+)\s*/i).filter(Boolean);

      return {
        rule: "MULTIPLE_ENTITIES",
        severity: "error",
        message: `Topic "${topic.name}" contains multiple entities`,
        reason: `Primary entity "${entity}" contains ${description}, indicating multiple items`,
        suggestion: `Split into ${parts.length} separate topics, one for each entity`,
        example: {
          before: entity,
          after: parts[0]?.trim() || "single specific entity",
        },
        fields: ["primaryEntity"],
      };
    }
  }

  return null;
}

/**
 * Check for bucket phrases in name or description.
 */
function checkBucketPhrases(topic: Topic): TopicValidationIssue[] {
  const issues: TopicValidationIssue[] = [];
  const fieldsToCheck: Array<{ field: keyof Topic; value: string | undefined }> = [
    { field: "name", value: topic.name },
    { field: "description", value: topic.description },
    { field: "primaryEntity", value: topic.primaryEntity },
  ];

  for (const { field, value } of fieldsToCheck) {
    if (!value) continue;

    for (const { pattern, description } of BUCKET_PHRASES) {
      if (pattern.test(value)) {
        issues.push({
          rule: "BUCKET_PHRASE",
          severity: "error",
          message: `Topic "${topic.name}" uses bucket phrase`,
          reason: `Field "${field}" contains ${description} — this describes a category, not an atomic topic`,
          suggestion: `Replace with a specific entity name. What SINGLE thing are you researching?`,
          example: {
            before: `"Vegan foods that reduce acne"`,
            after: `"Blueberry consumption impacts acne severity"`,
          },
          fields: [field],
        });
        break; // One issue per field is enough
      }
    }
  }

  return issues;
}

/**
 * Check for vague quantifiers that suggest non-specific entities.
 */
function checkVagueQuantifiers(topic: Topic): TopicValidationIssue[] {
  const issues: TopicValidationIssue[] = [];
  const fieldsToCheck: Array<{ field: keyof Topic; value: string | undefined }> = [
    { field: "name", value: topic.name },
    { field: "primaryEntity", value: topic.primaryEntity },
  ];

  for (const { field, value } of fieldsToCheck) {
    if (!value) continue;

    for (const { pattern, description } of VAGUE_QUANTIFIERS) {
      if (pattern.test(value)) {
        issues.push({
          rule: "VAGUE_QUANTIFIER",
          severity: "error",
          message: `Topic "${topic.name}" uses vague quantifier`,
          reason: `Field "${field}" contains ${description} — this is too vague for an atomic topic`,
          suggestion: `Remove the quantifier and name the specific entity`,
          example: {
            before: `"Various herbs for skin"`,
            after: `"Turmeric for skin redness"`,
          },
          fields: [field],
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Check for plural nouns that should be specific singular entities.
 */
function checkPluralBuckets(topic: Topic): TopicValidationIssue[] {
  const issues: TopicValidationIssue[] = [];
  const entity = topic.primaryEntity;

  // Skip if entity is a known valid plural (like "oats", "greens")
  const validPlurals = ["oats", "greens", "flaxseeds", "chia seeds"];
  if (validPlurals.some((v) => entity.toLowerCase().includes(v))) {
    return issues;
  }

  for (const { pattern, singular } of PLURAL_BUCKET_NOUNS) {
    if (pattern.test(entity)) {
      // Check if it's the main noun (not just part of a phrase)
      const words = entity.toLowerCase().split(/\s+/);
      const matchingWord = words.find((w) => pattern.test(w));

      if (matchingWord) {
        issues.push({
          rule: "PLURAL_WITHOUT_SPECIFIC",
          severity: "error",
          message: `Topic "${topic.name}" uses plural noun without specific entity`,
          reason: `Primary entity "${entity}" contains plural "${matchingWord}" — name the specific ${singular}`,
          suggestion: `Replace plural category with a single, named ${singular}`,
          example: {
            before: `"Ayurvedic herbs"`,
            after: `"Ashwagandha" or "Turmeric" or "Neem"`,
          },
          fields: ["primaryEntity"],
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Check for compound terms that should be separate topics.
 */
function checkCompoundTerms(topic: Topic): TopicValidationIssue | null {
  const fieldsToCheck = [topic.primaryEntity, topic.name, topic.description].filter(Boolean);

  for (const value of fieldsToCheck) {
    for (const { pattern, description } of COMPOUND_PATTERNS) {
      if (pattern.test(value!)) {
        return {
          rule: "COMPOUND_ENTITY",
          severity: "error",
          message: `Topic "${topic.name}" contains compound term`,
          reason: `Contains ${description} — this should be split into separate topics`,
          suggestion: `Create one topic for each item in the compound`,
          example: {
            before: `"Fruits and vegetables for skin"`,
            after: `"Blueberries for skin" + "Spinach for skin" (separate topics)`,
          },
          fields: ["primaryEntity", "name"],
        };
      }
    }
  }

  return null;
}

/**
 * Check for lists in the name field.
 */
function checkListInName(topic: Topic): TopicValidationIssue | null {
  const name = topic.name;

  // Check for comma-separated items or 'and' patterns in name
  const listPatterns = [
    /,\s*\w+\s*,/, // Multiple commas
    /,\s*\w+\s+and\s+\w+/i, // "x, y and z"
    /\w+,\s*\w+\s+and\s+/i, // "x, y, and"
  ];

  for (const pattern of listPatterns) {
    if (pattern.test(name)) {
      return {
        rule: "LIST_IN_NAME",
        severity: "error",
        message: `Topic name contains a list of items`,
        reason: `Name "${name}" appears to list multiple entities`,
        suggestion: `Topic name should reference only the single primary entity`,
        example: {
          before: `"Turmeric, Ginger, and Neem for Acne"`,
          after: `"Turmeric Reduces Acne Inflammation"`,
        },
        fields: ["name"],
      };
    }
  }

  return null;
}

/**
 * Check mechanism for multiple claims.
 */
function checkMultipleClaims(topic: Topic): TopicValidationIssue | null {
  const mechanism = topic.claim.mechanism;
  if (!mechanism) return null;

  // Count occurrences of 'and' that might indicate multiple mechanisms
  const andMatches = mechanism.match(/\band\b/gi) || [];

  if (andMatches.length >= 2) {
    return {
      rule: "MULTIPLE_CLAIMS",
      severity: "warning",
      message: `Topic mechanism may contain multiple claims`,
      reason: `Mechanism "${mechanism}" contains multiple 'and' conjunctions, suggesting multiple effects`,
      suggestion: `Focus on the PRIMARY mechanism. If multiple mechanisms are important, create separate topics`,
      example: {
        before: `"reduces inflammation and balances hormones and improves circulation"`,
        after: `"reduces inflammation via COX-2 inhibition"`,
      },
      fields: ["claim.mechanism"],
    };
  }

  return null;
}

/**
 * Check for generic category-style names.
 */
function checkGenericCategoryName(topic: Topic): TopicValidationIssue | null {
  const name = topic.name.toLowerCase();

  // Patterns that suggest a category rather than a specific claim
  const categoryPatterns = [
    /^(?:best|top|key)\s+\w+\s+for\s+/i,
    /^how\s+to\s+(?:use|choose|pick|select)/i,
    /^guide\s+to\s+/i,
    /^overview\s+of\s+/i,
    /^introduction\s+to\s+/i,
    /^understanding\s+/i,
    /complete\s+guide/i,
    /everything\s+(?:you\s+)?(?:need\s+to\s+)?know/i,
  ];

  for (const pattern of categoryPatterns) {
    if (pattern.test(name)) {
      return {
        rule: "GENERIC_CATEGORY_NAME",
        severity: "warning",
        message: `Topic name sounds like a category or guide`,
        reason: `Name "${topic.name}" suggests a broad category rather than a specific claim`,
        suggestion: `Rephrase to state the specific claim: "[Entity] [helps/harms] [condition]"`,
        example: {
          before: `"Best Foods for Clear Skin"`,
          after: `"Blueberry Antioxidants Reduce Acne"`,
        },
        fields: ["name"],
      };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a topic for atomicity constraints.
 *
 * This function runs all validation checks and returns a structured result
 * that can be used to:
 *   1. Block non-atomic topics from ingestion (if errors)
 *   2. Flag topics for review (if warnings)
 *   3. Provide actionable feedback for correction
 *
 * @param topic - The topic to validate
 * @returns Validation result with all issues found
 *
 * @example
 *   const result = validateTopicAtomicity(topic);
 *
 *   if (!result.isCanonical) {
 *     console.log("Topic cannot be ingested:");
 *     for (const issue of result.issues) {
 *       console.log(formatValidationIssue(issue));
 *     }
 *   }
 */
export function validateTopicAtomicity(topic: Topic): TopicAtomicityResult {
  const issues: TopicValidationIssue[] = [];

  // Run all validators
  const multipleEntities = checkMultipleEntities(topic);
  if (multipleEntities) issues.push(multipleEntities);

  issues.push(...checkBucketPhrases(topic));
  issues.push(...checkVagueQuantifiers(topic));
  issues.push(...checkPluralBuckets(topic));

  const compoundTerm = checkCompoundTerms(topic);
  if (compoundTerm) issues.push(compoundTerm);

  const listInName = checkListInName(topic);
  if (listInName) issues.push(listInName);

  const multipleClaims = checkMultipleClaims(topic);
  if (multipleClaims) issues.push(multipleClaims);

  const genericName = checkGenericCategoryName(topic);
  if (genericName) issues.push(genericName);

  // Count by severity
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  return {
    isValid: issues.length === 0,
    isCanonical: errorCount === 0, // Warnings don't block canonicalization
    issues,
    errorCount,
    warningCount,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a validation issue as a human-readable string.
 *
 * @example Output:
 *   ERROR [MULTIPLE_ENTITIES]: Topic "Turmeric and Ginger" contains multiple entities
 *   REASON: Primary entity "turmeric and ginger" contains conjunction 'and', indicating multiple items
 *   SUGGESTION: Split into 2 separate topics, one for each entity
 *   EXAMPLE:
 *     Before: "turmeric and ginger"
 *     After:  "turmeric"
 */
export function formatValidationIssue(issue: TopicValidationIssue): string {
  const severityLabel = issue.severity.toUpperCase();
  const lines: string[] = [
    `${severityLabel} [${issue.rule}]: ${issue.message}`,
    `  REASON: ${issue.reason}`,
    `  SUGGESTION: ${issue.suggestion}`,
  ];

  if (issue.example) {
    lines.push(`  EXAMPLE:`);
    lines.push(`    Before: ${issue.example.before}`);
    lines.push(`    After:  ${issue.example.after}`);
  }

  lines.push(`  FIELDS: ${issue.fields.join(", ")}`);

  return lines.join("\n");
}

/**
 * Format all validation issues for a topic.
 */
export function formatValidationResult(
  topic: Topic,
  result: TopicAtomicityResult
): string {
  if (result.isValid) {
    return `✓ Topic "${topic.name}" passes all atomicity checks`;
  }

  const lines: string[] = [
    ``,
    `═══════════════════════════════════════════════════════════════`,
    `TOPIC VALIDATION FAILED: "${topic.name}"`,
    `═══════════════════════════════════════════════════════════════`,
    `Errors: ${result.errorCount} | Warnings: ${result.warningCount}`,
    `Canonical: ${result.isCanonical ? "YES (warnings only)" : "NO (has errors)"}`,
    ``,
  ];

  for (const issue of result.issues) {
    lines.push(formatValidationIssue(issue));
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * Validate multiple topics and return a summary.
 */
export function validateTopics(
  topics: Topic[]
): {
  valid: Topic[];
  invalid: Array<{ topic: Topic; result: TopicAtomicityResult }>;
  summary: string;
} {
  const valid: Topic[] = [];
  const invalid: Array<{ topic: Topic; result: TopicAtomicityResult }> = [];

  for (const topic of topics) {
    const result = validateTopicAtomicity(topic);
    if (result.isCanonical) {
      valid.push(topic);
    } else {
      invalid.push({ topic, result });
    }
  }

  const summary = [
    `Topic Validation Summary`,
    `────────────────────────`,
    `Total:   ${topics.length}`,
    `Valid:   ${valid.length}`,
    `Invalid: ${invalid.length}`,
    ``,
  ].join("\n");

  return { valid, invalid, summary };
}
