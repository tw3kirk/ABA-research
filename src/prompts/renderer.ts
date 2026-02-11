/**
 * Prompt renderer.
 *
 * Takes a ParsedTemplate and a PromptContext and produces the final
 * prompt string. Enforces strict variable discipline and centrally
 * injects constraints that templates cannot bypass.
 *
 * Processing pipeline:
 *
 *   1. Conditional blocks are resolved first — each `{{#if …}}…{{/if}}`
 *      block is either included or excluded based on context values.
 *   2. Every remaining {{variable}} in the resolved text MUST exist in
 *      the context with a real value (not the UNSET sentinel).
 *   3. Optionally, every variable in the context SHOULD be used by the
 *      template — either as a {{variable}} placeholder in the resolved
 *      text or as a conditional test variable (strict mode).
 *   4. If PromptConstraints are provided, they are appended as an
 *      immutable "Constraints & Exclusions" section that the template
 *      cannot modify or omit.
 *
 * The renderer does NOT perform any content generation — it is purely
 * mechanical text substitution, conditional evaluation, and constraint
 * injection.
 */

import type { ParsedTemplate } from "./template.js";
import { extractVariables } from "./template.js";
import type { PromptContext, PromptVariable } from "./context.js";
import { isUnset } from "./context.js";
import { resolveConditionals } from "./conditional.js";
import { formatConstraints, type PromptConstraints } from "./constraints.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PromptRenderError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly missingVariables: string[],
    message?: string
  ) {
    super(
      message ??
        `Cannot render template "${templateName}": context is missing ` +
          `value(s) for: ${missingVariables.join(", ")}`
    );
    this.name = "PromptRenderError";
  }
}

export class UnusedVariableError extends Error {
  constructor(
    public readonly templateName: string,
    public readonly unusedVariables: string[],
    message?: string
  ) {
    super(
      message ??
        `Template "${templateName}" does not use context variable(s): ${unusedVariables.join(", ")}. ` +
          `Pass { strict: false } to allow unused variables.`
    );
    this.name = "UnusedVariableError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RenderOptions {
  /**
   * When true (default), rendering fails if the context contains variables
   * that the template does not reference. This catches context/template
   * mismatches early.
   *
   * Set to false when rendering partial templates that intentionally use
   * only a subset of the available context.
   */
  strict?: boolean;

  /**
   * Prompt constraints to inject after rendering.
   *
   * When provided, the formatted constraint text is appended to the end
   * of the rendered prompt as a clearly labeled "Constraints & Exclusions"
   * section. This injection happens AFTER all template processing, making
   * it impossible for template content to modify, suppress, or reorder
   * the constraints.
   *
   * Build these via `buildPromptConstraints()` from constraints.ts.
   */
  constraints?: PromptConstraints;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Regex that matches `{{variable}}` with optional inner whitespace. */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Render a parsed template against a typed prompt context.
 *
 * Processing order:
 *   1. Resolve conditional blocks (evaluate {{#if …}}…{{/if}})
 *   2. Extract remaining {{variable}} placeholders from resolved text
 *   3. Check all remaining variables have values (not UNSET)
 *   4. In strict mode, check no context variables are unused
 *   5. Perform variable substitution
 *   6. Inject constraints (if provided) — appended unconditionally
 *
 * @param template    - A previously parsed (and validated) template
 * @param context     - A PromptContext built via buildPromptContext()
 * @param options     - Rendering options (strict mode, constraints, etc.)
 * @returns The final prompt string with all conditionals, placeholders,
 *          and constraints resolved
 *
 * @throws PromptRenderError   if any remaining variable is missing or UNSET
 * @throws UnusedVariableError if strict mode is on and context has unused vars
 */
export function renderPrompt(
  template: ParsedTemplate,
  context: PromptContext,
  options: RenderOptions = {}
): string {
  const { strict = true, constraints } = options;
  const templateName = template.name ?? "(anonymous)";

  // --- 1. Resolve conditional blocks ---
  const resolvedSource = template.conditionals.length > 0
    ? resolveConditionals(template.source, context)
    : template.source;

  // --- 2. Extract variables from the resolved text ---
  // After conditionals are resolved, excluded blocks' variables are gone.
  const resolvedVarNames = extractVariables(resolvedSource);

  // --- 3. Check for missing / UNSET variables ---
  const missing: string[] = [];
  for (const variable of resolvedVarNames) {
    const value = context[variable as PromptVariable];
    if (value === undefined || isUnset(value)) {
      missing.push(variable);
    }
  }

  if (missing.length > 0) {
    throw new PromptRenderError(templateName, missing);
  }

  // --- 4. Check for unused context variables (strict mode) ---
  if (strict) {
    // Variables count as "used" if they appear as {{var}} placeholders
    // in the resolved text OR as conditional test variables.
    const usedSet = new Set<string>(resolvedVarNames);
    for (const cond of template.conditionals) {
      usedSet.add(cond.variable);
    }

    const contextKeys = Object.keys(context) as PromptVariable[];
    const unused = contextKeys.filter(
      (k) => !usedSet.has(k) && !isUnset(context[k])
    );

    if (unused.length > 0) {
      throw new UnusedVariableError(templateName, unused);
    }
  }

  // --- 5. Perform substitution on the resolved text ---
  PLACEHOLDER_RE.lastIndex = 0;
  const rendered = resolvedSource.replace(PLACEHOLDER_RE, (_match, name: string) => {
    return context[name as PromptVariable] ?? "";
  });

  // --- 6. Inject constraints (if provided) ---
  // Constraints are appended AFTER all template processing. The template
  // has no mechanism to suppress, reorder, or modify this section.
  if (constraints) {
    const constraintBlock = formatConstraints(constraints);
    return rendered + "\n" + constraintBlock;
  }

  return rendered;
}
