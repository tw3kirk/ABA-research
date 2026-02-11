/**
 * Conditional block parsing, validation, and evaluation.
 *
 * Extends the prompt template syntax with `{{#if …}}…{{/if}}` blocks
 * that include or exclude content based on context values.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SUPPORTED SYNTAX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   BOOLEAN (truthy) check — include block when value is non-empty/non-UNSET:
 *
 *     {{#if topic.claim.mechanism}}
 *     Mechanism: {{topic.claim.mechanism}}
 *     {{/if}}
 *
 *   EQUALITY check — include block when value matches a literal:
 *
 *     {{#if topic.claim.direction == "harms"}}
 *     Investigate harmful pathways.
 *     {{/if}}
 *
 *   INEQUALITY check — include block when value does NOT match:
 *
 *     {{#if topic.category != "habits_that_harm_skin"}}
 *     Include dietary research sections.
 *     {{/if}}
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONSTRAINTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   - No nesting — `{{#if}}` blocks cannot contain other `{{#if}}` blocks
 *   - No `{{#else}}` — use a separate `{{#if}}` with `!=` instead
 *   - No arbitrary expressions — only variable references and string literals
 *   - Variable names validated at parse time against PromptContextMap
 *   - Enum values validated at parse time for variables with known enum sets
 *   - UNSET variables evaluate to false for truthy, never match for equality
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS AVOIDS PROMPT DUPLICATION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Without conditionals, you need N templates for N category variants:
 *     deep-research-helps.md, deep-research-harms.md, etc.
 *
 *   With conditionals, ONE template handles all variants:
 *     {{#if topic.claim.direction == "harms"}}
 *     Include ethical and welfare research sections.
 *     {{/if}}
 *
 *   For 10 categories × 4 conditions × 2 directions = 80 combinations,
 *   you maintain 1 template instead of 80.
 */

import type { PromptVariable } from "./context.js";
import { isUnset } from "./context.js";
import { SkinCondition, ContentCategory } from "../config/research/enums.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported conditional operators. */
export type ConditionalOperator = "==" | "!=" | "truthy";

/**
 * A parsed conditional block from a template.
 */
export interface ConditionalBlock {
  /** The context variable being tested. */
  variable: PromptVariable;
  /** The comparison operator. */
  operator: ConditionalOperator;
  /** The literal value for == / != comparisons (undefined for truthy). */
  value?: string;
  /** The body text inside the block (may contain {{var}} placeholders). */
  body: string;
  /** The full raw text of the block including opening/closing tags. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConditionalParseError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly issues: string[],
    message?: string
  ) {
    super(
      message ??
        `Template "${templateName}" has invalid conditional(s):\n  - ${issues.join("\n  - ")}`
    );
    this.name = "ConditionalParseError";
  }
}

// ---------------------------------------------------------------------------
// Enum validation map
// ---------------------------------------------------------------------------

/**
 * Variables with constrained enum values.
 *
 * When a conditional uses `==` or `!=` with one of these variables, the
 * comparison value is validated at parse time against this set.
 * Variables NOT in this map accept any string comparison.
 */
const ENUM_VALUES: Partial<Record<PromptVariable, ReadonlySet<string>>> = {
  "topic.condition": new Set<string>(SkinCondition.options),
  "topic.category": new Set<string>(ContentCategory.options),
  "topic.claim.direction": new Set(["helps", "harms"]),
  "topic.entityType": new Set(["food", "herb", "ingredient", "chemical", "practice", "habit"]),
  "topic.priority": new Set(["high", "medium", "low"]),
  "topic.status": new Set(["active", "draft", "archived", "suspended"]),
  "topic.claim.confidence": new Set(["established", "emerging", "preliminary"]),
};

/**
 * Check whether a variable has a known enum value set.
 */
export function getEnumValues(variable: PromptVariable): ReadonlySet<string> | undefined {
  return ENUM_VALUES[variable];
}

// ---------------------------------------------------------------------------
// Regex
// ---------------------------------------------------------------------------

/**
 * Matches `{{#if variable}}`, `{{#if variable == "value"}}`, or
 * `{{#if variable != "value"}}` followed by body and `{{/if}}`.
 *
 * Groups:
 *   1: variable name
 *   2: operator (== or !=), optional
 *   3: comparison value (inside quotes), optional
 *   4: body content
 */
const CONDITIONAL_RE =
  /\{\{#if\s+([a-zA-Z][a-zA-Z0-9_.]*)\s*(?:(==|!=)\s*"([^"]*)")?\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

/**
 * Detects nested conditionals (invalid).
 */
const NESTED_IF_RE = /\{\{#if\s/;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract all conditional blocks from a template source string.
 *
 * @param source       - The raw template text
 * @param templateName - Template name for error messages
 * @param isValidVar   - Variable name validator function
 * @returns Array of parsed conditional blocks
 * @throws ConditionalParseError if blocks reference invalid variables or enum values
 */
export function parseConditionalBlocks(
  source: string,
  templateName: string,
  isValidVar: (name: string) => name is PromptVariable
): ConditionalBlock[] {
  const blocks: ConditionalBlock[] = [];
  const issues: string[] = [];

  CONDITIONAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CONDITIONAL_RE.exec(source)) !== null) {
    const [raw, variable, operator, value, body] = match;

    // 1. Validate variable name
    if (!isValidVar(variable)) {
      issues.push(`Unknown variable "${variable}" in conditional`);
      continue;
    }

    // 2. Check for nested conditionals
    if (NESTED_IF_RE.test(body)) {
      issues.push(
        `Nested conditionals are not supported (found {{#if inside {{#if ${variable}…}})`
      );
      continue;
    }

    // 3. Validate enum value for == / != checks
    const op: ConditionalOperator = operator
      ? (operator as "==" | "!=")
      : "truthy";

    if (op !== "truthy" && value !== undefined) {
      const enumSet = ENUM_VALUES[variable as PromptVariable];
      if (enumSet && !enumSet.has(value)) {
        const allowed = [...enumSet].sort().join(", ");
        issues.push(
          `Invalid value "${value}" for "${variable}" (allowed: ${allowed})`
        );
        continue;
      }
    }

    blocks.push({
      variable: variable as PromptVariable,
      operator: op,
      value: op !== "truthy" ? value : undefined,
      body,
      raw,
    });
  }

  // Check for unmatched {{#if}} or {{/if}} tags
  const openTags = source.match(/\{\{#if\s/g) ?? [];
  const closeTags = source.match(/\{\{\/if\}\}/g) ?? [];
  if (openTags.length !== closeTags.length) {
    issues.push(
      `Mismatched conditional tags: ${openTags.length} opening {{#if}}, ${closeTags.length} closing {{/if}}`
    );
  }

  if (issues.length > 0) {
    throw new ConditionalParseError(templateName, issues);
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single conditional block against a context value.
 *
 * Rules:
 *   - UNSET values → false for truthy, false for ==, true for !=
 *   - Empty string → false for truthy
 *   - truthy: non-empty and non-UNSET = true
 *   - ==: exact string match
 *   - !=: not an exact string match
 */
export function evaluateCondition(
  block: ConditionalBlock,
  contextValue: string
): boolean {
  const unset = isUnset(contextValue);

  switch (block.operator) {
    case "truthy":
      return !unset && contextValue !== "";

    case "==":
      return !unset && contextValue === block.value;

    case "!=":
      return unset || contextValue !== block.value;
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve all conditional blocks in a template source string.
 *
 * Evaluates each `{{#if …}}…{{/if}}` block and replaces it with either
 * the body content (if condition is true) or an empty string (if false).
 *
 * @param source  - The raw template text with conditional blocks
 * @param context - Record mapping variable names to string values
 * @returns The template text with all conditionals resolved
 */
export function resolveConditionals(
  source: string,
  context: Readonly<Record<string, string>>
): string {
  CONDITIONAL_RE.lastIndex = 0;

  return source.replace(CONDITIONAL_RE, (_match, variable: string, _op: string, value: string, body: string) => {
    const op: ConditionalOperator = _op ? (_op as "==" | "!=") : "truthy";
    const contextValue = context[variable] ?? "";

    const block: ConditionalBlock = {
      variable: variable as PromptVariable,
      operator: op,
      value: op !== "truthy" ? value : undefined,
      body,
      raw: _match,
    };

    return evaluateCondition(block, contextValue) ? body : "";
  });
}
