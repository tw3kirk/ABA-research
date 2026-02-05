/**
 * Research configuration module.
 *
 * Provides schema-validated, immutable configuration for research pipelines.
 *
 * Usage:
 *   import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "./config/research/index.js";
 *
 *   // Load with defaults
 *   const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
 *
 *   // Load with custom config
 *   const customConfig = loadResearchConfig({
 *     ...DEFAULT_RESEARCH_CONFIG,
 *     supportedConditions: ["acne", "eczema"],
 *   });
 */

// Domain enums
export {
  SkinCondition,
  ContentCategory,
  OutputFormat,
  EvidenceType,
  SourceType,
} from "./enums.js";

// Schema types
export type {
  ResearchConfig,
  QualityRequirements,
  SourcePolicy,
  ModelMetadata,
} from "./schema.js";

// Schema objects (for advanced validation scenarios)
export {
  ResearchConfigSchema,
  QualityRequirementsSchema,
  SourcePolicySchema,
  ModelMetadataSchema,
} from "./schema.js";

// Loader and validation
export {
  loadResearchConfig,
  validateResearchConfig,
  ResearchConfigError,
  type ConfigValidationIssue,
} from "./loader.js";

// Defaults
export { DEFAULT_RESEARCH_CONFIG } from "./defaults.js";
