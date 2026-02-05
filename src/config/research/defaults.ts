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
 */
export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  // All supported skin conditions enabled by default
  supportedConditions: [
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
  ],

  // Core content categories
  supportedCategories: [
    "pathophysiology",
    "treatment_options",
    "lifestyle_factors",
    "prevention",
    "diagnosis",
    "patient_education",
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
