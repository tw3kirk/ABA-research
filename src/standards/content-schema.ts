/**
 * Content standards schema definitions.
 *
 * Content standards are DECLARATIVE CONSTRAINTS that govern all generated content.
 * They define what content MUST and MUST NOT contain, without specifying HOW
 * to generate it.
 *
 * DESIGN PHILOSOPHY:
 *
 * 1. DECLARATIVE: Standards describe properties of valid content, not
 *    algorithms for producing it. This allows the generation system to
 *    evolve independently.
 *
 * 2. VERIFIABLE: Each constraint can be checked against generated content.
 *    Standards are useless if we can't verify compliance.
 *
 * 3. EDITABLE: Standards are loaded from configuration files, allowing
 *    updates without code changes. Legal, compliance, or brand teams
 *    can modify constraints directly.
 *
 * 4. COMPOSABLE: Different standard sets can be combined for different
 *    use cases (e.g., stricter medical disclaimers for treatment content).
 */

import { z } from "zod";

/**
 * Tone descriptor for content voice.
 */
export const ToneDescriptor = z.enum([
  "educational",
  "informative",
  "supportive",
  "empathetic",
  "professional",
  "conversational",
  "authoritative",
]);
export type ToneDescriptor = z.infer<typeof ToneDescriptor>;

/**
 * Tone rules governing content voice and style.
 */
export const ToneRulesSchema = z
  .object({
    /**
     * Primary tone descriptors (content should embody these).
     */
    primary: z
      .array(ToneDescriptor)
      .min(1)
      .describe("Primary tone qualities the content must embody"),

    /**
     * Secondary tone descriptors (content may include these).
     */
    secondary: z
      .array(ToneDescriptor)
      .default([])
      .describe("Secondary tone qualities that are acceptable"),

    /**
     * Tone descriptors to avoid (content should not embody these).
     */
    avoid: z
      .array(z.string())
      .default([])
      .describe("Tone qualities to avoid (e.g., 'alarmist', 'dismissive')"),

    /**
     * Target reading level (Flesch-Kincaid grade level).
     */
    readingLevel: z
      .object({
        min: z.number().min(1).max(18),
        max: z.number().min(1).max(18),
      })
      .optional()
      .describe("Target reading level range (Flesch-Kincaid grade)"),

    /**
     * Perspective to use (first person, second person, third person).
     */
    perspective: z
      .enum(["first_person", "second_person", "third_person", "mixed"])
      .default("second_person")
      .describe("Grammatical perspective for content"),
  })
  .strict();

export type ToneRules = z.infer<typeof ToneRulesSchema>;

/**
 * Citation requirements for content.
 */
export const CitationRequirementsSchema = z
  .object({
    /**
     * Require inline citations for factual claims.
     */
    requireInlineCitations: z
      .boolean()
      .default(true)
      .describe("Whether factual claims must have inline citations"),

    /**
     * Citation format to use.
     */
    format: z
      .enum(["numeric", "author_year", "footnote", "hyperlink"])
      .default("numeric")
      .describe("Citation format style"),

    /**
     * Require a references section at the end.
     */
    requireReferencesSection: z
      .boolean()
      .default(true)
      .describe("Whether to include a references section"),

    /**
     * Minimum number of references per piece of content.
     */
    minReferences: z
      .number()
      .int()
      .min(0)
      .default(3)
      .describe("Minimum references required per content piece"),

    /**
     * Types of claims that require citation.
     */
    citationRequiredFor: z
      .array(
        z.enum([
          "statistics",
          "medical_claims",
          "treatment_efficacy",
          "study_results",
          "prevalence_data",
          "mechanism_descriptions",
        ])
      )
      .default(["statistics", "medical_claims", "treatment_efficacy", "study_results"])
      .describe("Types of claims that must be cited"),
  })
  .strict();

export type CitationRequirements = z.infer<typeof CitationRequirementsSchema>;

/**
 * Forbidden content patterns.
 */
export const ForbiddenContentSchema = z
  .object({
    /**
     * Exact phrases that must never appear.
     */
    exactPhrases: z
      .array(z.string())
      .default([])
      .describe("Exact phrases that must never appear in content"),

    /**
     * Pattern-based restrictions (regex patterns as strings).
     */
    patterns: z
      .array(
        z.object({
          pattern: z.string().describe("Regex pattern to match"),
          reason: z.string().describe("Why this pattern is forbidden"),
          severity: z.enum(["error", "warning"]).default("error"),
        })
      )
      .default([])
      .describe("Regex patterns that must not match in content"),

    /**
     * Categories of claims that are forbidden.
     */
    forbiddenClaims: z
      .array(
        z.object({
          category: z.string().describe("Category of forbidden claim"),
          description: z.string().describe("What makes this claim forbidden"),
          examples: z.array(z.string()).default([]).describe("Example forbidden phrases"),
        })
      )
      .default([])
      .describe("Categories of claims that must not appear"),

    /**
     * Words to avoid (with suggested alternatives).
     */
    avoidWords: z
      .array(
        z.object({
          word: z.string(),
          reason: z.string().optional(),
          alternatives: z.array(z.string()).default([]),
        })
      )
      .default([])
      .describe("Words to avoid with optional alternatives"),
  })
  .strict();

export type ForbiddenContent = z.infer<typeof ForbiddenContentSchema>;

/**
 * Required content elements.
 */
export const RequiredContentSchema = z
  .object({
    /**
     * Disclaimers that must appear in content.
     */
    disclaimers: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for the disclaimer"),
          text: z.string().describe("Disclaimer text (may include placeholders)"),
          placement: z.enum(["start", "end", "both"]).default("end"),
          appliesTo: z
            .array(z.string())
            .default(["*"])
            .describe("Content categories this applies to (* = all)"),
        })
      )
      .default([])
      .describe("Required disclaimers"),

    /**
     * Sections that must be included.
     */
    sections: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          required: z.boolean().default(false),
          appliesTo: z.array(z.string()).default(["*"]),
        })
      )
      .default([])
      .describe("Required content sections"),

    /**
     * Elements that must be present.
     */
    elements: z
      .array(z.enum(["summary", "key_takeaways", "call_to_action", "further_reading"]))
      .default([])
      .describe("Required content elements"),
  })
  .strict();

export type RequiredContent = z.infer<typeof RequiredContentSchema>;

/**
 * Brand alignment rules.
 */
export const BrandAlignmentSchema = z
  .object({
    /**
     * Brand values that content should reflect.
     */
    values: z
      .array(z.string())
      .default([])
      .describe("Brand values content should embody"),

    /**
     * Dietary/lifestyle alignment.
     */
    dietaryAlignment: z
      .array(z.enum(["vegan", "vegetarian", "cruelty_free", "sustainable", "organic"]))
      .default([])
      .describe("Dietary and lifestyle values to align with"),

    /**
     * Topics to emphasize.
     */
    emphasize: z
      .array(z.string())
      .default([])
      .describe("Topics or angles to emphasize"),

    /**
     * Topics to de-emphasize.
     */
    deemphasize: z
      .array(z.string())
      .default([])
      .describe("Topics or angles to minimize"),
  })
  .strict();

export type BrandAlignment = z.infer<typeof BrandAlignmentSchema>;

/**
 * Complete content standards schema.
 */
export const ContentStandardsSchema = z
  .object({
    /**
     * Schema version for migration support.
     */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),

    /**
     * Human-readable name for this standards set.
     */
    name: z.string().min(1),

    /**
     * Description of when these standards apply.
     */
    description: z.string().optional(),

    /**
     * Tone and voice rules.
     */
    tone: ToneRulesSchema,

    /**
     * Citation requirements.
     */
    citations: CitationRequirementsSchema,

    /**
     * Forbidden content patterns.
     */
    forbidden: ForbiddenContentSchema,

    /**
     * Required content elements.
     */
    required: RequiredContentSchema,

    /**
     * Brand alignment rules.
     */
    brand: BrandAlignmentSchema,
  })
  .strict();

export type ContentStandards = z.infer<typeof ContentStandardsSchema>;
