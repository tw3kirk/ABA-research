/**
 * SEO guidelines schema definitions.
 *
 * SEO guidelines are DECLARATIVE CONSTRAINTS for search engine optimization.
 * They specify structural and keyword requirements without prescribing
 * specific content.
 *
 * DESIGN PHILOSOPHY:
 *
 * 1. MEASURABLE: Each constraint has a numeric or boolean value that can
 *    be verified against generated content.
 *
 * 2. RANGE-BASED: Most constraints use min/max ranges rather than exact
 *    values, giving content flexibility while ensuring compliance.
 *
 * 3. FORMAT-SPECIFIC: Different output formats (blog, email, pdf) may
 *    have different SEO requirements.
 *
 * 4. EVOLVING: SEO best practices change; guidelines can be updated
 *    without code changes.
 */

import { z } from "zod";

/**
 * Numeric range constraint.
 */
export const RangeSchema = z
  .object({
    min: z.number(),
    max: z.number(),
  })
  .refine((data) => data.min <= data.max, {
    message: "min must be less than or equal to max",
  });

export type Range = z.infer<typeof RangeSchema>;

/**
 * Keyword density rules.
 */
export const KeywordDensitySchema = z
  .object({
    /**
     * Primary keyword density range (percentage of total words).
     */
    primaryKeyword: z
      .object({
        min: z.number().min(0).max(100),
        max: z.number().min(0).max(100),
      })
      .describe("Primary keyword density as percentage (e.g., 1-2%)"),

    /**
     * Secondary keyword density range.
     */
    secondaryKeywords: z
      .object({
        min: z.number().min(0).max(100),
        max: z.number().min(0).max(100),
      })
      .optional()
      .describe("Secondary keywords density as percentage"),

    /**
     * Maximum repetition of any single keyword in sequence.
     */
    maxConsecutiveRepetitions: z
      .number()
      .int()
      .min(1)
      .default(2)
      .describe("Max times a keyword can appear consecutively"),

    /**
     * Minimum distance (in words) between keyword occurrences.
     */
    minKeywordSpacing: z
      .number()
      .int()
      .min(0)
      .default(50)
      .describe("Minimum words between keyword occurrences"),
  })
  .strict();

export type KeywordDensity = z.infer<typeof KeywordDensitySchema>;

/**
 * Heading structure rules.
 */
export const HeadingStructureSchema = z
  .object({
    /**
     * Require exactly one H1.
     */
    requireSingleH1: z
      .boolean()
      .default(true)
      .describe("Whether content must have exactly one H1"),

    /**
     * H1 must contain primary keyword.
     */
    h1ContainsKeyword: z
      .boolean()
      .default(true)
      .describe("Whether H1 must contain the primary keyword"),

    /**
     * Minimum number of H2 headings.
     */
    minH2Count: z
      .number()
      .int()
      .min(0)
      .default(2)
      .describe("Minimum number of H2 headings"),

    /**
     * Maximum heading depth (H1=1, H2=2, etc.).
     */
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(6)
      .default(4)
      .describe("Maximum heading level to use"),

    /**
     * Require proper heading hierarchy (no skipping levels).
     */
    requireProperHierarchy: z
      .boolean()
      .default(true)
      .describe("Whether heading levels must not skip (e.g., H1->H3)"),

    /**
     * Percentage of H2s that should contain keywords.
     */
    keywordInH2Percentage: z
      .number()
      .min(0)
      .max(100)
      .default(50)
      .describe("Percentage of H2 headings that should contain keywords"),

    /**
     * Maximum words per heading.
     */
    maxHeadingWords: z
      .number()
      .int()
      .min(1)
      .default(10)
      .describe("Maximum words allowed in a heading"),
  })
  .strict();

export type HeadingStructure = z.infer<typeof HeadingStructureSchema>;

/**
 * Content length constraints.
 */
export const ContentLengthSchema = z
  .object({
    /**
     * Word count range for the entire content.
     */
    wordCount: z
      .object({
        min: z.number().int().min(0),
        max: z.number().int().min(0),
      })
      .describe("Total word count range"),

    /**
     * Paragraph length constraints.
     */
    paragraphWords: z
      .object({
        min: z.number().int().min(1).default(20),
        max: z.number().int().min(1).default(150),
      })
      .default({ min: 20, max: 150 })
      .describe("Words per paragraph range"),

    /**
     * Sentence length constraints.
     */
    sentenceWords: z
      .object({
        min: z.number().int().min(1).default(5),
        max: z.number().int().min(1).default(25),
      })
      .default({ min: 5, max: 25 })
      .describe("Words per sentence range"),

    /**
     * Maximum paragraphs before requiring a heading.
     */
    paragraphsBeforeHeading: z
      .number()
      .int()
      .min(1)
      .default(4)
      .describe("Max paragraphs allowed before a subheading"),
  })
  .strict();

export type ContentLength = z.infer<typeof ContentLengthSchema>;

/**
 * Meta content rules (titles, descriptions).
 */
export const MetaContentSchema = z
  .object({
    /**
     * Title length constraints (characters).
     */
    titleLength: z
      .object({
        min: z.number().int().min(1).default(30),
        max: z.number().int().min(1).default(60),
      })
      .default({ min: 30, max: 60 })
      .describe("Title length in characters"),

    /**
     * Title must contain primary keyword.
     */
    titleContainsKeyword: z
      .boolean()
      .default(true)
      .describe("Whether title must contain primary keyword"),

    /**
     * Keyword should be near the beginning of title.
     */
    keywordInFirstHalf: z
      .boolean()
      .default(true)
      .describe("Whether keyword should appear in first half of title"),

    /**
     * Meta description length constraints.
     */
    descriptionLength: z
      .object({
        min: z.number().int().min(1).default(120),
        max: z.number().int().min(1).default(160),
      })
      .default({ min: 120, max: 160 })
      .describe("Meta description length in characters"),

    /**
     * Description must contain primary keyword.
     */
    descriptionContainsKeyword: z
      .boolean()
      .default(true)
      .describe("Whether meta description must contain primary keyword"),

    /**
     * Require a call-to-action in description.
     */
    descriptionRequiresCTA: z
      .boolean()
      .default(false)
      .describe("Whether meta description should include a CTA"),
  })
  .strict();

export type MetaContent = z.infer<typeof MetaContentSchema>;

/**
 * Link and media requirements.
 */
export const LinkMediaSchema = z
  .object({
    /**
     * Internal links per 1000 words.
     */
    internalLinksPerThousandWords: z
      .object({
        min: z.number().min(0).default(2),
        max: z.number().min(0).default(5),
      })
      .default({ min: 2, max: 5 })
      .describe("Internal links per 1000 words"),

    /**
     * External links per 1000 words.
     */
    externalLinksPerThousandWords: z
      .object({
        min: z.number().min(0).default(1),
        max: z.number().min(0).default(3),
      })
      .default({ min: 1, max: 3 })
      .describe("External links per 1000 words"),

    /**
     * Require alt text for images.
     */
    requireImageAltText: z
      .boolean()
      .default(true)
      .describe("Whether images must have alt text"),

    /**
     * Alt text should contain keywords.
     */
    altTextContainsKeyword: z
      .boolean()
      .default(false)
      .describe("Whether image alt text should contain keywords"),

    /**
     * Minimum images per 500 words.
     */
    imagesPerFiveHundredWords: z
      .number()
      .min(0)
      .default(1)
      .describe("Minimum images per 500 words of content"),
  })
  .strict();

export type LinkMedia = z.infer<typeof LinkMediaSchema>;

/**
 * Readability constraints.
 */
export const ReadabilitySchema = z
  .object({
    /**
     * Target Flesch Reading Ease score range.
     */
    fleschReadingEase: z
      .object({
        min: z.number().min(0).max(100).default(60),
        max: z.number().min(0).max(100).default(80),
      })
      .default({ min: 60, max: 80 })
      .describe("Flesch Reading Ease score range (60-80 = standard)"),

    /**
     * Maximum percentage of passive voice sentences.
     */
    maxPassiveVoicePercent: z
      .number()
      .min(0)
      .max(100)
      .default(15)
      .describe("Maximum percentage of sentences in passive voice"),

    /**
     * Maximum percentage of sentences starting with the same word.
     */
    maxConsecutiveSameStart: z
      .number()
      .int()
      .min(1)
      .default(2)
      .describe("Max consecutive sentences starting with same word"),

    /**
     * Require varied sentence structure.
     */
    requireVariedSentenceLength: z
      .boolean()
      .default(true)
      .describe("Whether sentence lengths should vary"),
  })
  .strict();

export type Readability = z.infer<typeof ReadabilitySchema>;

/**
 * Complete SEO guidelines schema.
 */
export const SeoGuidelinesSchema = z
  .object({
    /**
     * Schema version for migration support.
     */
    version: z.string().regex(/^\d+\.\d+\.\d+$/),

    /**
     * Human-readable name for this guideline set.
     */
    name: z.string().min(1),

    /**
     * Description of when these guidelines apply.
     */
    description: z.string().optional(),

    /**
     * Output formats these guidelines apply to.
     */
    appliesTo: z
      .array(z.string())
      .default(["*"])
      .describe("Output formats these apply to (* = all)"),

    /**
     * Keyword density rules.
     */
    keywordDensity: KeywordDensitySchema,

    /**
     * Heading structure rules.
     */
    headingStructure: HeadingStructureSchema,

    /**
     * Content length constraints.
     */
    contentLength: ContentLengthSchema,

    /**
     * Meta content rules.
     */
    metaContent: MetaContentSchema,

    /**
     * Link and media requirements.
     */
    linkMedia: LinkMediaSchema,

    /**
     * Readability constraints.
     */
    readability: ReadabilitySchema,
  })
  .strict();

export type SeoGuidelines = z.infer<typeof SeoGuidelinesSchema>;
