/**
 * Environment variable loading and validation.
 */

import "dotenv/config";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Get a required environment variable.
 * Throws ConfigError if the variable is missing or empty.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value.
 */
export function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== "" ? value : defaultValue;
}

/**
 * Get an optional environment variable as an integer.
 */
export function optionalEnvInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new ConfigError(
      `Environment variable ${key} must be a valid integer, got: ${value}`
    );
  }
  return parsed;
}

/**
 * Get an optional environment variable as a boolean.
 * Recognizes: true, false, 1, 0, yes, no (case-insensitive)
 */
export function optionalEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no"].includes(normalized)) {
    return false;
  }
  throw new ConfigError(
    `Environment variable ${key} must be a boolean (true/false/1/0/yes/no), got: ${value}`
  );
}
