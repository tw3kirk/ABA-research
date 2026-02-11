/**
 * Prompt renderer.
 *
 * Takes a ParsedTemplate and a PromptContext and produces the final
 * prompt string. Enforces strict variable discipline:
 *
 *   1. Every variable in the template MUST exist in the context with a
 *      real value (not the UNSET sentinel).
 *   2. Optionally, every variable in the context SHOULD be used by the
 *      template (unused variables are flagged).
 *
 * The renderer does NOT perform any content generation — it is purely
 * mechanical text substitution.
 */

import type { ParsedTemplate } from "./template.js";
import type { PromptContext, PromptVariable } from "./context.js";
import { isUnset } from "./context.js";

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
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

/** Regex that matches `{{variable}}` with optional inner whitespace. */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

/**
 * Render a parsed template against a typed prompt context.
 *
 * @param template - A previously parsed (and validated) template
 * @param context  - A PromptContext built via buildPromptContext()
 * @param options  - Rendering options (strict mode, etc.)
 * @returns The final prompt string with all placeholders replaced
 *
 * @throws PromptRenderError   if any template variable is missing or UNSET
 * @throws UnusedVariableError if strict mode is on and context has unused vars
 */
export function renderPrompt(
  template: ParsedTemplate,
  context: PromptContext,
  options: RenderOptions = {}
): string {
  const { strict = true } = options;
  const templateName = template.name ?? "(anonymous)";

  // --- Check for missing / UNSET variables ---
  const missing: string[] = [];
  for (const variable of template.variables) {
    const value = context[variable];
    if (value === undefined || isUnset(value)) {
      missing.push(variable);
    }
  }

  if (missing.length > 0) {
    throw new PromptRenderError(templateName, missing);
  }

  // --- Check for unused context variables (strict mode) ---
  if (strict) {
    const usedSet = new Set<string>(template.variables);
    const contextKeys = Object.keys(context) as PromptVariable[];
    const unused = contextKeys.filter(
      (k) => !usedSet.has(k) && !isUnset(context[k])
    );

    if (unused.length > 0) {
      throw new UnusedVariableError(templateName, unused);
    }
  }

  // --- Perform substitution ---
  PLACEHOLDER_RE.lastIndex = 0;
  const rendered = template.source.replace(PLACEHOLDER_RE, (_match, name: string) => {
    return context[name as PromptVariable] ?? "";
  });

  return rendered;
}
