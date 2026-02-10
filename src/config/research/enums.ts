/**
 * Domain enumerations for research configuration.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  BUSINESS-CRITICAL: These enums are the canonical domain definitions.     ║
 * ║  They are IMMUTABLE and must NOT be modified without executive approval.  ║
 * ║                                                                           ║
 * ║  Any change to these enums affects:                                       ║
 * ║    - All research topic definitions                                       ║
 * ║    - Content generation pipelines                                         ║
 * ║    - Validation logic across the entire system                            ║
 * ║    - Historical data compatibility                                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

import { z } from "zod";

/**
 * Supported skin conditions for research.
 *
 * CANONICAL LIST - DO NOT MODIFY WITHOUT BUSINESS APPROVAL
 *
 * These four conditions represent the complete scope of skin concerns
 * addressed by this research system. Each maps to a distinct set of
 * research topics and content strategies.
 *
 * @readonly
 * @enum {string}
 */
export const SkinCondition = z.enum([
  "redness_hyperpigmentation",
  "dryness_premature_aging",
  "oily_skin",
  "acne_acne_scars",
]);
export type SkinCondition = z.infer<typeof SkinCondition>;

/**
 * Research categories defining the lens through which content is created.
 *
 * CANONICAL LIST - DO NOT MODIFY WITHOUT BUSINESS APPROVAL
 *
 * These ten categories represent the complete taxonomy of research angles.
 * Each category has specific content requirements and evidence standards.
 *
 * Categories are organized into themes:
 *   BENEFICIAL (help skin):
 *     - vegan_foods_that_help_skin
 *     - ayurvedic_herbs_in_skincare_that_help_skin
 *     - ayurvedic_herbs_to_eat_that_benefit_skin
 *     - ayurvedic_practices_that_help_skin
 *     - other_practices_that_help_skin
 *
 *   HARMFUL (harm skin):
 *     - animal_ingredients_in_food_that_harm_skin
 *     - animal_ingredients_in_skincare_that_harm_skin
 *     - other_foods_that_harm_skin
 *     - skincare_chemicals_that_harm_skin
 *     - habits_that_harm_skin
 *
 * @readonly
 * @enum {string}
 */
export const ContentCategory = z.enum([
  "vegan_foods_that_help_skin",
  "ayurvedic_herbs_in_skincare_that_help_skin",
  "animal_ingredients_in_food_that_harm_skin",
  "animal_ingredients_in_skincare_that_harm_skin",
  "other_foods_that_harm_skin",
  "skincare_chemicals_that_harm_skin",
  "ayurvedic_practices_that_help_skin",
  "other_practices_that_help_skin",
  "habits_that_harm_skin",
  "ayurvedic_herbs_to_eat_that_benefit_skin",
]);
export type ContentCategory = z.infer<typeof ContentCategory>;

/**
 * Output formats for generated content.
 * Each format has different structural and stylistic requirements.
 */
export const OutputFormat = z.enum([
  "email",
  "blog",
  "pdf",
  "video_script",
  "social_media",
  "newsletter",
  "clinical_summary",
]);
export type OutputFormat = z.infer<typeof OutputFormat>;

/**
 * Evidence types accepted in research.
 * Ordered roughly by strength of evidence (strongest first).
 */
export const EvidenceType = z.enum([
  "systematic_review",
  "meta_analysis",
  "randomized_controlled_trial",
  "cohort_study",
  "case_control_study",
  "cross_sectional_study",
  "case_series",
  "case_report",
  "expert_opinion",
  "clinical_guideline",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/**
 * Source types for research materials.
 * Defines what kinds of publications are acceptable.
 */
export const SourceType = z.enum([
  "peer_reviewed_journal",
  "review_paper",
  "clinical_guideline",
  "medical_textbook",
  "government_health_agency",
  "professional_association",
  "preprint",
]);
export type SourceType = z.infer<typeof SourceType>;
