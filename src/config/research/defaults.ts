/**
 * Default research configuration.
 *
 * This provides sensible defaults for research configuration.
 * These defaults prioritize:
 * - High-quality, peer-reviewed sources
 * - Recent research (within 10 years)
 * - Multiple citations for credibility
 * - Standard output formats
 *
 * Projects should override these defaults as needed for their specific
 * research requirements.
 */

import type { ResearchConfig } from "./schema.js";

/**
 * Default research configuration.
 * Suitable for general skin health research with high quality standards.
 *
 * NOTE: supportedConditions and supportedCategories use the canonical
 * domain enums defined in enums.ts. These are business-critical and
 * must not be modified without approval.
 */
export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  // All 4 canonical skin conditions enabled by default
  supportedConditions: [
    "redness_hyperpigmentation",
    "dryness_premature_aging",
    "oily_skin",
    "acne_acne_scars",
  ],

  // All 10 canonical content categories enabled by default
  supportedCategories: [
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
  ],

  // Standard output formats
  allowedOutputFormats: ["email", "blog", "pdf", "newsletter"],

  // Quality requirements
  qualityRequirements: {
    minCitationsPerClaim: 2,
    minSourcesPerTopic: 3,
    maxSourceAgeYears: 10,
    allowedEvidenceTypes: [
      "systematic_review",
      "meta_analysis",
      "randomized_controlled_trial",
      "cohort_study",
      "clinical_guideline",
    ],
    requireHighQualitySource: true,
  },

  // Source policy - conservative defaults
  sourcePolicy: {
    allowedSourceTypes: [
      "peer_reviewed_journal",
      "review_paper",
      "clinical_guideline",
      "government_health_agency",
      "professional_association",
    ],
    allowPreprints: false,
    requirePeerReview: true,
    excludedPublishers: [],
    excludedDomains: [],
    preferredDatabases: ["PubMed", "Cochrane Library", "MEDLINE"],
  },

  // Model metadata - placeholder values, should be overridden
  modelMetadata: {
    modelName: "claude-3-opus",
    modelVersion: "20240229",
    researchTool: "aba-research",
    researchToolVersion: "0.1.0",
    configSchemaVersion: "1.0.0",
  },
};
