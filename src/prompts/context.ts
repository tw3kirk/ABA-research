/**
 * Typed prompt context.
 *
 * Defines the strongly-typed context object that templates are rendered against.
 * Every valid `{{path.to.value}}` placeholder in a prompt template maps to a
 * concrete path in this context tree. Invalid paths produce compile-time errors
 * when building the context, and runtime errors when rendering.
 *
 * DESIGN:
 *
 * The context is a *flat namespace of dotted paths* backed by the real domain
 * objects. We deliberately expose a curated surface rather than the full object
 * tree so that template authors only reach for stable, meaningful values.
 *
 *   topic.entity          → topic.primaryEntity
 *   topic.condition       → topic.condition
 *   topic.claim.direction → topic.claim.direction
 *   research.runId        → spec.runMetadata.runId
 *   seo.wordCountMin      → seoGuidelines.contentLength.wordCount.min
 *
 * Adding a new variable requires exactly two changes:
 *   1. Add the key to PromptContextMap
 *   2. Add the extraction in buildPromptContext()
 *
 * SCALABILITY:
 *
 * This context is built once per topic and is O(1) to look up any variable.
 * Rendering 1,000 topics means 1,000 calls to buildPromptContext (cheap — it
 * just copies scalars) followed by 1,000 calls to renderPrompt (string replace).
 */

import type { Topic } from "../topics/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";
import type { SeoGuidelines } from "../standards/seo-schema.js";
import type { ResearchSpecification } from "../specification/schema.js";

// ---------------------------------------------------------------------------
// Context map: every legal template variable and its string type
// ---------------------------------------------------------------------------

/**
 * Exhaustive map of every variable available inside prompt templates.
 *
 * Keys are dotted paths exactly as they appear in `{{…}}` placeholders.
 * Values are always strings (template rendering is text-to-text).
 *
 * To add a new variable:
 *   1. Add the key here
 *   2. Populate it in `buildPromptContext()`
 */
export interface PromptContextMap {
  // ── Topic ──────────────────────────────────────────────────
  "topic.id": string;
  "topic.entity": string;
  "topic.entityType": string;
  "topic.name": string;
  "topic.description": string;
  "topic.condition": string;
  "topic.category": string;
  "topic.priority": string;
  "topic.status": string;

  // ── Claim ──────────────────────────────────────────────────
  "topic.claim.direction": string;
  "topic.claim.mechanism": string;
  "topic.claim.confidence": string;

  // ── Research specification metadata ────────────────────────
  "research.runId": string;
  "research.version": string;
  "research.startedAt": string;
  "research.totalTopics": string;
  "research.activeTopics": string;

  // ── Research quality requirements ──────────────────────────
  "research.minCitationsPerClaim": string;
  "research.minSourcesPerTopic": string;
  "research.maxSourceAgeYears": string;
  "research.allowedEvidenceTypes": string;
  "research.preferredDatabases": string;

  // ── Content standards ──────────────────────────────────────
  "contentStandards.name": string;
  "contentStandards.tone": string;
  "contentStandards.perspective": string;
  "contentStandards.readingLevelMin": string;
  "contentStandards.readingLevelMax": string;
  "contentStandards.citationFormat": string;
  "contentStandards.minReferences": string;
  "contentStandards.citationRequiredFor": string;
  "contentStandards.forbiddenPhrases": string;
  "contentStandards.requiredDisclaimers": string;
  "contentStandards.brandValues": string;
  "contentStandards.emphasize": string;
  "contentStandards.deemphasize": string;

  // ── SEO guidelines ─────────────────────────────────────────
  "seo.name": string;
  "seo.wordCountMin": string;
  "seo.wordCountMax": string;
  "seo.keywordDensityMin": string;
  "seo.keywordDensityMax": string;
  "seo.minH2Count": string;
  "seo.maxHeadingWords": string;
  "seo.metaTitleLengthMin": string;
  "seo.metaTitleLengthMax": string;
  "seo.metaDescriptionLengthMin": string;
  "seo.metaDescriptionLengthMax": string;
  "seo.fleschReadingEaseMin": string;
  "seo.fleschReadingEaseMax": string;
  "seo.maxPassiveVoicePercent": string;
}

/** A legal prompt variable name. */
export type PromptVariable = keyof PromptContextMap;

/** The concrete context object passed to the renderer. */
export type PromptContext = Readonly<PromptContextMap>;

// ---------------------------------------------------------------------------
// Builder input
// ---------------------------------------------------------------------------

/**
 * Input for building a prompt context.
 *
 * `topic` is always required — prompts are per-topic.
 * The rest are optional; variables that depend on a missing source
 * will be populated with a sentinel value so the renderer can still
 * detect their absence if a template requires them.
 */
export interface PromptContextInput {
  topic: Readonly<Topic>;
  specification?: Readonly<ResearchSpecification>;
  contentStandards?: Readonly<ContentStandards>;
  seoGuidelines?: Readonly<SeoGuidelines>;
}

/** Sentinel for variables whose source was not provided. */
const UNSET = "__UNSET__";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a fully-populated prompt context from domain objects.
 *
 * Each field in `PromptContextMap` is populated here. If the source
 * for a group of variables is missing (e.g. no contentStandards provided),
 * those variables receive the `UNSET` sentinel so that the renderer
 * can raise a clear error if a template actually references them.
 */
export function buildPromptContext(input: PromptContextInput): PromptContext {
  const { topic, specification, contentStandards, seoGuidelines } = input;

  const ctx: PromptContextMap = {
    // ── Topic ────────────────────────────────────────────────
    "topic.id": topic.id,
    "topic.entity": topic.primaryEntity,
    "topic.entityType": topic.entityType,
    "topic.name": topic.name,
    "topic.description": topic.description ?? "",
    "topic.condition": topic.condition,
    "topic.category": topic.category,
    "topic.priority": topic.priority,
    "topic.status": topic.status,

    // ── Claim ────────────────────────────────────────────────
    "topic.claim.direction": topic.claim.direction,
    "topic.claim.mechanism": topic.claim.mechanism ?? "",
    "topic.claim.confidence": topic.claim.confidence,

    // ── Research spec ────────────────────────────────────────
    "research.runId": specification?.runMetadata.runId ?? UNSET,
    "research.version": specification?.specificationVersion ?? UNSET,
    "research.startedAt": specification?.runMetadata.startedAt ?? UNSET,
    "research.totalTopics": specification
      ? String(specification.stats.totalTopics)
      : UNSET,
    "research.activeTopics": specification
      ? String(specification.stats.activeTopics)
      : UNSET,

    // ── Research quality ─────────────────────────────────────
    "research.minCitationsPerClaim": specification
      ? String(specification.researchConfig.qualityRequirements.minCitationsPerClaim)
      : UNSET,
    "research.minSourcesPerTopic": specification
      ? String(specification.researchConfig.qualityRequirements.minSourcesPerTopic)
      : UNSET,
    "research.maxSourceAgeYears": specification
      ? String(specification.researchConfig.qualityRequirements.maxSourceAgeYears)
      : UNSET,
    "research.allowedEvidenceTypes": specification
      ? specification.researchConfig.qualityRequirements.allowedEvidenceTypes.join(", ")
      : UNSET,
    "research.preferredDatabases": specification
      ? specification.researchConfig.sourcePolicy.preferredDatabases.join(", ")
      : UNSET,

    // ── Content standards ────────────────────────────────────
    "contentStandards.name": contentStandards?.name ?? UNSET,
    "contentStandards.tone": contentStandards
      ? contentStandards.tone.primary.join(", ")
      : UNSET,
    "contentStandards.perspective": contentStandards
      ? contentStandards.tone.perspective
      : UNSET,
    "contentStandards.readingLevelMin": contentStandards?.tone.readingLevel
      ? String(contentStandards.tone.readingLevel.min)
      : UNSET,
    "contentStandards.readingLevelMax": contentStandards?.tone.readingLevel
      ? String(contentStandards.tone.readingLevel.max)
      : UNSET,
    "contentStandards.citationFormat": contentStandards
      ? contentStandards.citations.format
      : UNSET,
    "contentStandards.minReferences": contentStandards
      ? String(contentStandards.citations.minReferences)
      : UNSET,
    "contentStandards.citationRequiredFor": contentStandards
      ? contentStandards.citations.citationRequiredFor.join(", ")
      : UNSET,
    "contentStandards.forbiddenPhrases": contentStandards
      ? contentStandards.forbidden.exactPhrases.join("; ")
      : UNSET,
    "contentStandards.requiredDisclaimers": contentStandards
      ? contentStandards.required.disclaimers.map((d) => d.text).join("\n")
      : UNSET,
    "contentStandards.brandValues": contentStandards
      ? contentStandards.brand.values.join(", ")
      : UNSET,
    "contentStandards.emphasize": contentStandards
      ? contentStandards.brand.emphasize.join(", ")
      : UNSET,
    "contentStandards.deemphasize": contentStandards
      ? contentStandards.brand.deemphasize.join(", ")
      : UNSET,

    // ── SEO guidelines ───────────────────────────────────────
    "seo.name": seoGuidelines?.name ?? UNSET,
    "seo.wordCountMin": seoGuidelines
      ? String(seoGuidelines.contentLength.wordCount.min)
      : UNSET,
    "seo.wordCountMax": seoGuidelines
      ? String(seoGuidelines.contentLength.wordCount.max)
      : UNSET,
    "seo.keywordDensityMin": seoGuidelines
      ? String(seoGuidelines.keywordDensity.primaryKeyword.min)
      : UNSET,
    "seo.keywordDensityMax": seoGuidelines
      ? String(seoGuidelines.keywordDensity.primaryKeyword.max)
      : UNSET,
    "seo.minH2Count": seoGuidelines
      ? String(seoGuidelines.headingStructure.minH2Count)
      : UNSET,
    "seo.maxHeadingWords": seoGuidelines
      ? String(seoGuidelines.headingStructure.maxHeadingWords)
      : UNSET,
    "seo.metaTitleLengthMin": seoGuidelines
      ? String(seoGuidelines.metaContent.titleLength.min)
      : UNSET,
    "seo.metaTitleLengthMax": seoGuidelines
      ? String(seoGuidelines.metaContent.titleLength.max)
      : UNSET,
    "seo.metaDescriptionLengthMin": seoGuidelines
      ? String(seoGuidelines.metaContent.descriptionLength.min)
      : UNSET,
    "seo.metaDescriptionLengthMax": seoGuidelines
      ? String(seoGuidelines.metaContent.descriptionLength.max)
      : UNSET,
    "seo.fleschReadingEaseMin": seoGuidelines
      ? String(seoGuidelines.readability.fleschReadingEase.min)
      : UNSET,
    "seo.fleschReadingEaseMax": seoGuidelines
      ? String(seoGuidelines.readability.fleschReadingEase.max)
      : UNSET,
    "seo.maxPassiveVoicePercent": seoGuidelines
      ? String(seoGuidelines.readability.maxPassiveVoicePercent)
      : UNSET,
  };

  return Object.freeze(ctx);
}

/**
 * Check whether a context value is the UNSET sentinel.
 * Used by the renderer to produce clear errors.
 */
export function isUnset(value: string): boolean {
  return value === UNSET;
}
