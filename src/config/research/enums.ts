/**
 * Domain enumerations for research configuration.
 *
 * These enums define the fixed, supported values for the research pipeline.
 * They are intentionally restrictive to ensure consistency and prevent
 * accidental expansion of scope without explicit review.
 */

import { z } from "zod";

/**
 * Supported skin conditions for research.
 * This is a controlled vocabulary - new conditions require explicit addition.
 */
export const SkinCondition = z.enum([
  "acne",
  "eczema",
  "psoriasis",
  "rosacea",
  "dermatitis",
  "hyperpigmentation",
  "melasma",
  "vitiligo",
  "seborrheic_dermatitis",
  "keratosis_pilaris",
]);
export type SkinCondition = z.infer<typeof SkinCondition>;

/**
 * Content categories for research organization.
 * Determines the lens through which research is conducted and presented.
 */
export const ContentCategory = z.enum([
  "pathophysiology",
  "treatment_options",
  "lifestyle_factors",
  "prevention",
  "diagnosis",
  "prognosis",
  "epidemiology",
  "patient_education",
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
