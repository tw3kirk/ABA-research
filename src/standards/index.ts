/**
 * Content standards and SEO guidelines module.
 *
 * This module provides declarative constraints that govern all generated content.
 * Standards are loaded from configuration files and validated at startup,
 * then passed to generation stages as immutable constraints.
 *
 * DESIGN PRINCIPLES:
 *
 * 1. DECLARATIVE: Standards describe WHAT content must/must not contain,
 *    not HOW to generate it. This separation allows generation logic to
 *    evolve independently.
 *
 * 2. VERIFIABLE: Every constraint can be checked against generated content.
 *    This enables automated compliance checking post-generation.
 *
 * 3. EDITABLE: Standards are JSON files that can be modified by non-developers
 *    (legal, compliance, brand teams) without code changes.
 *
 * 4. COMPOSABLE: Different standard sets can be combined or overridden
 *    for different content types or audiences.
 *
 * INTEGRATION WITH PIPELINE:
 *
 * Standards integrate with the research pipeline through ResearchSpecification:
 *
 * ```typescript
 * const spec = createSpecification({
 *   runId,
 *   researchConfig,
 *   topics,
 *   contentStandards: loadContentStandardsFromFile("config/content-standards.json"),
 *   seoGuidelines: loadSeoGuidelinesFromFile("config/seo-guidelines.json"),
 * });
 *
 * // Content generator receives constraints
 * function generateContent(topic: Topic, spec: ResearchSpecification) {
 *   // Must comply with spec.contentStandards.tone
 *   // Must comply with spec.contentStandards.forbidden
 *   // Must include spec.contentStandards.required.disclaimers
 *   // Must meet spec.seoGuidelines.keywordDensity
 *   // etc.
 * }
 * ```
 *
 * VALIDATION STAGES:
 *
 * 1. LOAD-TIME: Schema validation ensures structural correctness
 * 2. CONSTRAINT: Cross-field validation ensures logical consistency
 * 3. RUNTIME: Content can be checked against standards post-generation
 */

// Content standards
export {
  ContentStandardsSchema,
  ToneRulesSchema,
  CitationRequirementsSchema,
  ForbiddenContentSchema,
  RequiredContentSchema,
  BrandAlignmentSchema,
  ToneDescriptor,
  type ContentStandards,
  type ToneRules,
  type CitationRequirements,
  type ForbiddenContent,
  type RequiredContent,
  type BrandAlignment,
} from "./content-schema.js";

// SEO guidelines
export {
  SeoGuidelinesSchema,
  KeywordDensitySchema,
  HeadingStructureSchema,
  ContentLengthSchema,
  MetaContentSchema,
  LinkMediaSchema,
  ReadabilitySchema,
  type SeoGuidelines,
  type KeywordDensity,
  type HeadingStructure,
  type ContentLength,
  type MetaContent,
  type LinkMedia,
  type Readability,
} from "./seo-schema.js";

// Loaders
export {
  loadContentStandards,
  loadSeoGuidelines,
  loadContentStandardsFromFile,
  loadSeoGuidelinesFromFile,
  validateContentStandards,
  validateSeoGuidelines,
  loadTopicContentConstraints,
  StandardsValidationError,
  type StandardsIssue,
  type ValidationResult,
  type LoadTopicConstraintsOptions,
} from "./loader.js";

// Topic-aware content constraints
export {
  deriveTopicConstraints,
  formatConstraintIssues,
  GuidelineRuleSchema,
  type GuidelineRule,
  type TopicContentConstraints,
  type ConstraintIssue,
  type TopicConstraintsResult,
} from "./topic-constraints.js";
