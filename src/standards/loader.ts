/**
 * Standards and guidelines loaders.
 *
 * Provides validated loading of content standards and SEO guidelines
 * from configuration files (JSON format).
 *
 * NORMALIZATION:
 * Loaders normalize inputs by:
 * - Applying default values for optional fields
 * - Sorting arrays for deterministic comparison
 * - Validating cross-field constraints
 * - Deep freezing for immutability
 */

import { readFileSync } from "node:fs";
import { ContentStandardsSchema, type ContentStandards } from "./content-schema.js";
import { SeoGuidelinesSchema, type SeoGuidelines } from "./seo-schema.js";

/**
 * Validation error for standards loading.
 */
export class StandardsValidationError extends Error {
  public readonly issues: StandardsIssue[];

  constructor(message: string, issues: StandardsIssue[]) {
    super(message);
    this.name = "StandardsValidationError";
    this.issues = issues;
  }

  format(): string {
    const lines = ["Standards validation failed:"];
    for (const issue of this.issues) {
      lines.push(`  - ${issue.path}: ${issue.message}`);
    }
    return lines.join("\n");
  }
}

/**
 * Individual validation issue.
 */
export interface StandardsIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Deep freeze an object for immutability.
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
 * Normalize content standards after validation.
 * - Sorts arrays for deterministic comparison
 * - Ensures consistent structure
 */
function normalizeContentStandards(standards: ContentStandards): ContentStandards {
  return {
    ...standards,
    tone: {
      ...standards.tone,
      primary: [...standards.tone.primary].sort(),
      secondary: [...standards.tone.secondary].sort(),
      avoid: [...standards.tone.avoid].sort(),
    },
    citations: {
      ...standards.citations,
      citationRequiredFor: [...standards.citations.citationRequiredFor].sort(),
    },
    forbidden: {
      ...standards.forbidden,
      exactPhrases: [...standards.forbidden.exactPhrases].sort(),
    },
    brand: {
      ...standards.brand,
      values: [...standards.brand.values].sort(),
      dietaryAlignment: [...standards.brand.dietaryAlignment].sort(),
    },
  };
}

/**
 * Normalize SEO guidelines after validation.
 */
function normalizeSeoGuidelines(guidelines: SeoGuidelines): SeoGuidelines {
  return {
    ...guidelines,
    appliesTo: [...guidelines.appliesTo].sort(),
  };
}

/**
 * Validate additional constraints that Zod can't express.
 */
function validateContentStandardsConstraints(standards: ContentStandards): StandardsIssue[] {
  const issues: StandardsIssue[] = [];

  // Reading level min must be <= max
  if (standards.tone.readingLevel) {
    if (standards.tone.readingLevel.min > standards.tone.readingLevel.max) {
      issues.push({
        path: "tone.readingLevel",
        message: "min reading level must be <= max",
        code: "invalid_range",
      });
    }
  }

  // Check for contradictory tone settings
  const primarySet = new Set(standards.tone.primary);
  for (const avoided of standards.tone.avoid) {
    if (primarySet.has(avoided as typeof standards.tone.primary[number])) {
      issues.push({
        path: "tone",
        message: `"${avoided}" cannot be both primary and avoided`,
        code: "contradiction",
      });
    }
  }

  return issues;
}

/**
 * Validate additional SEO constraints.
 */
function validateSeoGuidelinesConstraints(guidelines: SeoGuidelines): StandardsIssue[] {
  const issues: StandardsIssue[] = [];

  // Word count min must be <= max
  if (guidelines.contentLength.wordCount.min > guidelines.contentLength.wordCount.max) {
    issues.push({
      path: "contentLength.wordCount",
      message: "min word count must be <= max",
      code: "invalid_range",
    });
  }

  // Keyword density min must be <= max
  if (guidelines.keywordDensity.primaryKeyword.min > guidelines.keywordDensity.primaryKeyword.max) {
    issues.push({
      path: "keywordDensity.primaryKeyword",
      message: "min density must be <= max",
      code: "invalid_range",
    });
  }

  // Heading depth must allow for minimum H2 count
  if (guidelines.headingStructure.maxDepth < 2 && guidelines.headingStructure.minH2Count > 0) {
    issues.push({
      path: "headingStructure",
      message: "maxDepth must be >= 2 if minH2Count > 0",
      code: "invalid_constraint",
    });
  }

  return issues;
}

/**
 * Load and validate content standards from raw input.
 *
 * @param input - Raw standards object or JSON string
 * @returns Validated and normalized content standards
 * @throws StandardsValidationError if validation fails
 */
export function loadContentStandards(input: unknown): Readonly<ContentStandards> {
  // Parse if string
  const data = typeof input === "string" ? JSON.parse(input) : input;

  // Validate schema
  const result = ContentStandardsSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
      code: i.code,
    }));
    throw new StandardsValidationError(
      `Content standards validation failed: ${issues.length} error(s)`,
      issues
    );
  }

  // Validate additional constraints
  const constraintIssues = validateContentStandardsConstraints(result.data);
  if (constraintIssues.length > 0) {
    throw new StandardsValidationError(
      `Content standards constraint validation failed`,
      constraintIssues
    );
  }

  // Normalize and freeze
  const normalized = normalizeContentStandards(result.data);
  return deepFreeze(normalized);
}

/**
 * Load and validate SEO guidelines from raw input.
 *
 * @param input - Raw guidelines object or JSON string
 * @returns Validated and normalized SEO guidelines
 * @throws StandardsValidationError if validation fails
 */
export function loadSeoGuidelines(input: unknown): Readonly<SeoGuidelines> {
  // Parse if string
  const data = typeof input === "string" ? JSON.parse(input) : input;

  // Validate schema
  const result = SeoGuidelinesSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join(".") || "(root)",
      message: i.message,
      code: i.code,
    }));
    throw new StandardsValidationError(
      `SEO guidelines validation failed: ${issues.length} error(s)`,
      issues
    );
  }

  // Validate additional constraints
  const constraintIssues = validateSeoGuidelinesConstraints(result.data);
  if (constraintIssues.length > 0) {
    throw new StandardsValidationError(
      `SEO guidelines constraint validation failed`,
      constraintIssues
    );
  }

  // Normalize and freeze
  const normalized = normalizeSeoGuidelines(result.data);
  return deepFreeze(normalized);
}

/**
 * Load content standards from a file.
 *
 * @param filePath - Path to JSON file
 * @returns Validated content standards
 */
export function loadContentStandardsFromFile(filePath: string): Readonly<ContentStandards> {
  const json = readFileSync(filePath, "utf-8");
  return loadContentStandards(json);
}

/**
 * Load SEO guidelines from a file.
 *
 * @param filePath - Path to JSON file
 * @returns Validated SEO guidelines
 */
export function loadSeoGuidelinesFromFile(filePath: string): Readonly<SeoGuidelines> {
  const json = readFileSync(filePath, "utf-8");
  return loadSeoGuidelines(json);
}

/**
 * Validation result type.
 */
export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: StandardsIssue[];
}

/**
 * Validate content standards without throwing.
 */
export function validateContentStandards(input: unknown): ValidationResult<ContentStandards> {
  try {
    const data = loadContentStandards(input);
    return { success: true, data };
  } catch (err) {
    if (err instanceof StandardsValidationError) {
      return { success: false, errors: err.issues };
    }
    throw err;
  }
}

/**
 * Validate SEO guidelines without throwing.
 */
export function validateSeoGuidelines(input: unknown): ValidationResult<SeoGuidelines> {
  try {
    const data = loadSeoGuidelines(input);
    return { success: true, data };
  } catch (err) {
    if (err instanceof StandardsValidationError) {
      return { success: false, errors: err.issues };
    }
    throw err;
  }
}
