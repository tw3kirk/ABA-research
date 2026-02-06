/**
 * Specification serialization for audit and reproducibility.
 *
 * The specification can be serialized to disk in JSON format for:
 *
 * 1. AUDIT TRAIL: Every run produces a specification file that documents
 *    exactly what parameters governed the research. This enables compliance
 *    review and quality audits.
 *
 * 2. REPRODUCIBILITY: A serialized specification can be loaded and used
 *    to reproduce the exact same run (with the same inputs, though outputs
 *    may vary due to LLM non-determinism).
 *
 * 3. DEBUGGING: When issues arise, the specification file shows exactly
 *    what configuration was active, making root cause analysis possible.
 *
 * 4. VERSIONING: The specificationVersion field allows loaders to detect
 *    old formats and apply migrations if schema has evolved.
 *
 * FILE NAMING CONVENTION:
 * Specifications are saved as: specification-{runId}.json
 * This allows easy correlation with log files and outputs.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  type ResearchSpecification,
  ResearchSpecificationSchema,
  SPECIFICATION_VERSION,
} from "./schema.js";
import { SpecificationError } from "./factory.js";

/**
 * Deep freeze an object and all nested objects.
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  const propNames = Reflect.ownKeys(obj);
  for (const name of propNames) {
    const value = (obj as Record<string | symbol, unknown>)[name];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }
  return Object.freeze(obj);
}

/**
 * Serialize a specification to a JSON string.
 *
 * @param spec - The specification to serialize
 * @param pretty - Whether to format with indentation (default: true)
 * @returns JSON string representation
 */
export function serializeSpecification(
  spec: ResearchSpecification,
  pretty = true
): string {
  return JSON.stringify(spec, null, pretty ? 2 : undefined);
}

/**
 * Deserialize a specification from a JSON string.
 *
 * @param json - JSON string to parse
 * @returns Validated and frozen specification
 * @throws SpecificationError if parsing or validation fails
 */
export function deserializeSpecification(json: string): Readonly<ResearchSpecification> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new SpecificationError(
      `Failed to parse specification JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Validate against schema
  const result = ResearchSpecificationSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new SpecificationError(`Invalid specification format: ${errors}`);
  }

  // Check version compatibility
  const spec = result.data;
  if (!isVersionCompatible(spec.specificationVersion)) {
    throw new SpecificationError(
      `Incompatible specification version: ${spec.specificationVersion} ` +
        `(current: ${SPECIFICATION_VERSION}). Migration may be required.`
    );
  }

  return deepFreeze(spec);
}

/**
 * Check if a specification version is compatible with current version.
 * For now, we only accept exact major version match.
 *
 * @param version - Version string to check
 * @returns Whether the version is compatible
 */
export function isVersionCompatible(version: string): boolean {
  const [major] = version.split(".").map(Number);
  const [currentMajor] = SPECIFICATION_VERSION.split(".").map(Number);
  return major === currentMajor;
}

/**
 * Generate the standard filename for a specification.
 *
 * @param runId - The run identifier
 * @returns Filename in format "specification-{runId}.json"
 */
export function getSpecificationFilename(runId: string): string {
  return `specification-${runId}.json`;
}

/**
 * Save a specification to a file.
 *
 * @param spec - The specification to save
 * @param directory - Directory to save in
 * @param filename - Optional filename override (defaults to standard naming)
 * @returns Full path to the saved file
 */
export function saveSpecification(
  spec: ResearchSpecification,
  directory: string,
  filename?: string
): string {
  const name = filename ?? getSpecificationFilename(spec.runMetadata.runId);
  const filePath = join(directory, name);

  // Ensure directory exists
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const json = serializeSpecification(spec);
  writeFileSync(filePath, json, "utf-8");

  return filePath;
}

/**
 * Load a specification from a file.
 *
 * @param filePath - Path to the specification file
 * @returns Validated and frozen specification
 * @throws SpecificationError if loading fails
 */
export function loadSpecification(filePath: string): Readonly<ResearchSpecification> {
  let json: string;
  try {
    json = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new SpecificationError(
      `Failed to read specification file: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return deserializeSpecification(json);
}

/**
 * Options for creating a specification summary.
 */
export interface SummaryOptions {
  /** Include topic list (default: false for brevity) */
  includeTopics?: boolean;
  /** Include full config (default: false for brevity) */
  includeConfig?: boolean;
}

/**
 * Create a human-readable summary of a specification.
 * Useful for logging and display purposes.
 *
 * @param spec - The specification to summarize
 * @param options - Summary options
 * @returns Formatted summary string
 */
export function summarizeSpecification(
  spec: ResearchSpecification,
  options: SummaryOptions = {}
): string {
  const lines: string[] = [
    "=== Research Specification ===",
    `Version: ${spec.specificationVersion}`,
    "",
    "--- Run Metadata ---",
    `Run ID: ${spec.runMetadata.runId}`,
    `Started: ${spec.runMetadata.startedAt}`,
  ];

  if (spec.runMetadata.hostname) {
    lines.push(`Hostname: ${spec.runMetadata.hostname}`);
  }

  if (spec.runMetadata.initiatedBy) {
    lines.push(`Initiated by: ${spec.runMetadata.initiatedBy}`);
  }

  if (spec.runMetadata.git) {
    lines.push("");
    lines.push("--- Git State ---");
    lines.push(`Commit: ${spec.runMetadata.git.commitShort} (${spec.runMetadata.git.branch})`);
    lines.push(`Dirty: ${spec.runMetadata.git.isDirty ? "yes" : "no"}`);
  }

  lines.push("");
  lines.push("--- Statistics ---");
  lines.push(`Total topics: ${spec.stats.totalTopics}`);
  lines.push(`Active topics: ${spec.stats.activeTopics}`);
  lines.push(`Unique conditions: ${spec.stats.uniqueConditions}`);
  lines.push(`Unique categories: ${spec.stats.uniqueCategories}`);

  if (options.includeTopics) {
    lines.push("");
    lines.push("--- Topics ---");
    for (const topic of spec.topicSummaries) {
      lines.push(`  - ${topic.id}: ${topic.condition}/${topic.category} [${topic.priority}]`);
    }
  }

  if (options.includeConfig) {
    lines.push("");
    lines.push("--- Research Config ---");
    lines.push(`Model: ${spec.researchConfig.modelMetadata.modelName}`);
    lines.push(`Min citations: ${spec.researchConfig.qualityRequirements.minCitationsPerClaim}`);
    lines.push(`Require peer review: ${spec.researchConfig.sourcePolicy.requirePeerReview}`);
  }

  // Content standards summary
  if (spec.contentStandards) {
    lines.push("");
    lines.push("--- Content Standards ---");
    lines.push(`Name: ${spec.contentStandards.name}`);
    lines.push(`Tone: ${spec.contentStandards.tone.primary.join(", ")}`);
    lines.push(`Brand alignment: ${spec.contentStandards.brand.dietaryAlignment.join(", ") || "none"}`);
    lines.push(`Forbidden phrases: ${spec.contentStandards.forbidden.exactPhrases.length}`);
    lines.push(`Required disclaimers: ${spec.contentStandards.required.disclaimers.length}`);
  }

  // SEO guidelines summary
  if (spec.seoGuidelines) {
    lines.push("");
    lines.push("--- SEO Guidelines ---");
    lines.push(`Name: ${spec.seoGuidelines.name}`);
    lines.push(`Word count: ${spec.seoGuidelines.contentLength.wordCount.min}-${spec.seoGuidelines.contentLength.wordCount.max}`);
    lines.push(`Keyword density: ${spec.seoGuidelines.keywordDensity.primaryKeyword.min}-${spec.seoGuidelines.keywordDensity.primaryKeyword.max}%`);
    lines.push(`Min H2 headings: ${spec.seoGuidelines.headingStructure.minH2Count}`);
  }

  return lines.join("\n");
}
