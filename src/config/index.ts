/**
 * Application configuration.
 * Validates and exposes typed configuration values.
 */

import {
  ConfigError,
  requireEnv,
  optionalEnv,
  optionalEnvInt,
  optionalEnvBool,
} from "./env.js";

export { ConfigError } from "./env.js";

// Re-export research configuration module
export * from "./research/index.js";

export interface AppConfig {
  /** Current environment (development, production, test) */
  readonly env: string;
  /** Enable debug mode */
  readonly debug: boolean;
  /** Log level */
  readonly logLevel: string;
  /** Application name */
  readonly appName: string;
}

/**
 * Load and validate application configuration.
 * Fails fast if required variables are missing.
 */
function loadConfig(): AppConfig {
  return {
    env: optionalEnv("NODE_ENV", "development"),
    debug: optionalEnvBool("DEBUG", false),
    logLevel: optionalEnv("LOG_LEVEL", "info"),
    appName: optionalEnv("APP_NAME", "aba-research"),
  };
}

/** Application configuration singleton */
export const config: AppConfig = loadConfig();

/**
 * Validate that all required configuration is present.
 * Call this at application startup to fail fast.
 */
export function validateConfig(): void {
  // Currently all config values have defaults.
  // Add required validations here as needed:
  // requireEnv("SOME_REQUIRED_KEY");

  if (!["development", "production", "test"].includes(config.env)) {
    throw new ConfigError(
      `Invalid NODE_ENV: ${config.env}. Must be development, production, or test.`
    );
  }

  if (!["debug", "info", "warn", "error"].includes(config.logLevel)) {
    throw new ConfigError(
      `Invalid LOG_LEVEL: ${config.logLevel}. Must be debug, info, warn, or error.`
    );
  }
}
