/**
 * Prompt template parsing and variable extraction.
 *
 * A prompt template is a plain-text string (typically loaded from a .md or
 * .txt file) containing `{{variable.path}}` placeholders and optional
 * `{{#if …}}…{{/if}}` conditional blocks.  This module extracts those
 * constructs and validates them against the typed PromptContextMap so that
 * invalid variable references are caught before rendering.
 *
 * TEMPLATE FORMAT:
 *
 *   VARIABLE SUBSTITUTION:
 *     {{topic.entity}}            — simple variable substitution
 *     {{topic.claim.direction}}   — nested path (flattened by convention)
 *
 *   CONDITIONAL BLOCKS:
 *     {{#if topic.claim.direction == "harms"}}
 *     Include harmful-entity research sections.
 *     {{/if}}
 *
 *     {{#if topic.claim.mechanism}}        — truthy check
 *     Mechanism: {{topic.claim.mechanism}}
 *     {{/if}}
 *
 *     {{#if topic.category != "habits_that_harm_skin"}}
 *     Include dietary research.
 *     {{/if}}
 *
 * Rules:
 *   - Placeholders use double-brace syntax: {{ and }}
 *   - Variable names are dotted alphanumeric paths
 *   - Whitespace inside braces is trimmed: {{ topic.entity }} is valid
 *   - Unrecognized variable names are rejected at validation time
 *   - Duplicate placeholders in a template are fine (same value rendered)
 *   - Conditional variables are validated for name and (where applicable)
 *     enum value correctness at parse time
 *   - No nested conditionals
 */

import type { PromptVariable } from "./context.js";
import {
  parseConditionalBlocks,
  type ConditionalBlock,
} from "./conditional.js";

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/**
 * Matches `{{variable.name}}` with optional inner whitespace.
 * Captures the trimmed variable name in group 1.
 */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

// ---------------------------------------------------------------------------
// Parsed template
// ---------------------------------------------------------------------------

/**
 * A parsed and validated prompt template.
 *
 * Contains the original source text, the set of unique variable names
 * found, and whether validation passed.
 */
export interface ParsedTemplate {
  /** The raw template source string (with placeholders intact). */
  source: string;
  /** Unique variable names found in {{…}} placeholders, sorted. */
  variables: PromptVariable[];
  /** Parsed conditional blocks ({{#if …}}…{{/if}}). */
  conditionals: ConditionalBlock[];
  /** Optional name/id for error messages. */
  name?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateParseError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly invalidVariables: string[],
    message?: string
  ) {
    super(
      message ??
        `Template "${templateName}" references unknown variable(s): ${invalidVariables.join(", ")}`
    );
    this.name = "TemplateParseError";
  }
}

// ---------------------------------------------------------------------------
// All valid variable names (derived from the PromptContextMap interface)
// ---------------------------------------------------------------------------

/**
 * Complete set of legal variable names.
 *
 * This list MUST stay in sync with PromptContextMap in context.ts.
 * It is the single runtime source of truth for validation.
 */
const VALID_VARIABLES: ReadonlySet<string> = new Set<PromptVariable>([
  // Topic
  "topic.id",
  "topic.entity",
  "topic.entityType",
  "topic.name",
  "topic.description",
  "topic.condition",
  "topic.category",
  "topic.priority",
  "topic.status",
  // Claim
  "topic.claim.direction",
  "topic.claim.mechanism",
  "topic.claim.confidence",
  // Research
  "research.runId",
  "research.version",
  "research.startedAt",
  "research.totalTopics",
  "research.activeTopics",
  "research.minCitationsPerClaim",
  "research.minSourcesPerTopic",
  "research.maxSourceAgeYears",
  "research.allowedEvidenceTypes",
  "research.preferredDatabases",
  // Content standards
  "contentStandards.name",
  "contentStandards.tone",
  "contentStandards.perspective",
  "contentStandards.readingLevelMin",
  "contentStandards.readingLevelMax",
  "contentStandards.citationFormat",
  "contentStandards.minReferences",
  "contentStandards.citationRequiredFor",
  "contentStandards.forbiddenPhrases",
  "contentStandards.requiredDisclaimers",
  "contentStandards.brandValues",
  "contentStandards.emphasize",
  "contentStandards.deemphasize",
  // SEO
  "seo.name",
  "seo.wordCountMin",
  "seo.wordCountMax",
  "seo.keywordDensityMin",
  "seo.keywordDensityMax",
  "seo.minH2Count",
  "seo.maxHeadingWords",
  "seo.metaTitleLengthMin",
  "seo.metaTitleLengthMax",
  "seo.metaDescriptionLengthMin",
  "seo.metaDescriptionLengthMax",
  "seo.fleschReadingEaseMin",
  "seo.fleschReadingEaseMax",
  "seo.maxPassiveVoicePercent",
]);

/**
 * Check whether a string is a valid prompt variable name.
 */
export function isValidVariable(name: string): name is PromptVariable {
  return VALID_VARIABLES.has(name);
}

/**
 * Return all valid variable names (sorted).
 */
export function getValidVariables(): PromptVariable[] {
  return [...VALID_VARIABLES].sort() as PromptVariable[];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all `{{…}}` placeholder names from a template string.
 * Returns deduplicated, sorted variable names.
 */
export function extractVariables(source: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  // Reset lastIndex for safety
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(source)) !== null) {
    found.add(match[1]);
  }
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Parsing + validation
// ---------------------------------------------------------------------------

/**
 * Parse a template string, extracting and validating all variables
 * and conditional blocks.
 *
 * @param source - The raw template text
 * @param name   - Optional template name for error messages
 * @returns A ParsedTemplate with validated variables and conditionals
 * @throws TemplateParseError      if any {{variable}} name is invalid
 * @throws ConditionalParseError   if any conditional references invalid vars/enums
 */
export function parseTemplate(source: string, name?: string): ParsedTemplate {
  // 1. Parse conditional blocks (validates variable names + enum values)
  const conditionals = parseConditionalBlocks(
    source,
    name ?? "(anonymous)",
    isValidVariable
  );

  // 2. Extract {{variable}} placeholders
  const rawVariables = extractVariables(source);
  const invalid = rawVariables.filter((v) => !isValidVariable(v));

  if (invalid.length > 0) {
    throw new TemplateParseError(name ?? "(anonymous)", invalid);
  }

  return {
    source,
    variables: rawVariables as PromptVariable[],
    conditionals,
    name,
  };
}
