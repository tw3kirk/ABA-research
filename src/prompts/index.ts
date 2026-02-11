/**
 * Prompt template system.
 *
 * Provides typed, validated prompt template loading and rendering
 * for the research pipeline. Templates use `{{variable}}` placeholders
 * that are validated against a typed context derived from the domain model.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```typescript
 * import {
 *   PromptTemplateLoader,
 *   buildPromptContext,
 *   renderPrompt,
 * } from "./prompts/index.js";
 *
 * // 1. Load a template
 * const loader = new PromptTemplateLoader("prompts/");
 * const template = loader.load("deep-research.md");
 *
 * // 2. Build a context for a specific topic
 * const context = buildPromptContext({
 *   topic,
 *   specification,
 *   contentStandards,
 *   seoGuidelines,
 * });
 *
 * // 3. Render the final prompt
 * const prompt = renderPrompt(template, context, { strict: false });
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * BATCH RENDERING (hundreds of topics)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ```typescript
 * const loader = new PromptTemplateLoader("prompts/");
 * const template = loader.load("deep-research.md");  // parse once
 *
 * for (const topic of specification.topics) {
 *   const ctx = buildPromptContext({ topic, specification });
 *   const prompt = renderPrompt(template, ctx, { strict: false });
 *   // send prompt to LLM
 * }
 * ```
 */

// Context
export {
  buildPromptContext,
  isUnset,
  type PromptContext,
  type PromptContextMap,
  type PromptContextInput,
  type PromptVariable,
} from "./context.js";

// Template parsing
export {
  parseTemplate,
  extractVariables,
  isValidVariable,
  getValidVariables,
  TemplateParseError,
  type ParsedTemplate,
} from "./template.js";

// Rendering
export {
  renderPrompt,
  PromptRenderError,
  UnusedVariableError,
  type RenderOptions,
} from "./renderer.js";

// Loader
export {
  PromptTemplateLoader,
  TemplateLoadError,
} from "./loader.js";
