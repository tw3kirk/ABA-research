/**
 * Research configuration loader and validator.
 *
 * Responsible for:
 * - Loading configuration from various sources
 * - Validating against the schema with fail-fast behavior
 * - Producing clear, structured error messages
 * - Freezing configuration to enforce immutability
 */

import { z, ZodError, ZodIssue } from "zod";
import { ResearchConfigSchema, type ResearchConfig } from "./schema.js";

/**
 * Structured validation error for research configuration.
 */
export class ResearchConfigError extends Error {
  public readonly issues: ConfigValidationIssue[];

  constructor(message: string, issues: ConfigValidationIssue[]) {
    super(message);
    this.name = "ResearchConfigError";
    this.issues = issues;
  }

  /**
   * Format errors for display.
   */
  format(): string {
    const lines = ["Research configuration validation failed:"];
    for (const issue of this.issues) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      lines.push(`  - ${path}: ${issue.message}`);
    }
    return lines.join("\n");
  }
}

/**
 * Individual validation issue.
 */
export interface ConfigValidationIssue {
  /** Path to the invalid field */
  path: (string | number)[];
  /** Human-readable error message */
  message: string;
  /** Zod error code */
  code: string;
}

/**
 * Convert Zod issues to our structured format.
 */
function formatZodIssues(zodIssues: ZodIssue[]): ConfigValidationIssue[] {
  return zodIssues.map((issue) => ({
    // Filter path to only strings and numbers (symbols are rare in config)
    path: issue.path.filter(
      (p): p is string | number => typeof p === "string" || typeof p === "number"
    ),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Deep freeze an object to enforce runtime immutability.
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  const propNames = Reflect.ownKeys(obj) as (keyof T)[];

  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }

  return Object.freeze(obj);
}

/**
 * Validate and load research configuration.
 *
 * This function:
 * 1. Validates the input against the ResearchConfig schema
 * 2. Fails fast with structured errors if validation fails
 * 3. Deep freezes the result to enforce immutability
 *
 * @param input - Raw configuration object to validate
 * @returns Validated and frozen ResearchConfig
 * @throws ResearchConfigError if validation fails
 */
export function loadResearchConfig(input: unknown): Readonly<ResearchConfig> {
  const result = ResearchConfigSchema.safeParse(input);

  if (!result.success) {
    const issues = formatZodIssues(result.error.issues);
    const error = new ResearchConfigError(
      `Invalid research configuration: ${issues.length} validation error(s)`,
      issues
    );
    throw error;
  }

  // Deep freeze to enforce immutability at runtime
  return deepFreeze(result.data);
}

/**
 * Validate research configuration without loading.
 * Useful for checking config files before committing to a run.
 *
 * @param input - Raw configuration object to validate
 * @returns Validation result with success status and any errors
 */
export function validateResearchConfig(input: unknown): {
  success: boolean;
  config?: ResearchConfig;
  errors?: ConfigValidationIssue[];
} {
  const result = ResearchConfigSchema.safeParse(input);

  if (result.success) {
    return { success: true, config: result.data };
  }

  return {
    success: false,
    errors: formatZodIssues(result.error.issues),
  };
}
