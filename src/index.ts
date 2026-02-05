/**
 * Entry point for ABA research pipeline.
 */

import { config, validateConfig, ConfigError } from "./config/index.js";
import { initRunId, createLogger } from "./logging/index.js";
import type { LogLevel } from "./logging/index.js";

function main(): void {
  // Initialize run ID first
  const runId = initRunId();

  // Create logger with config-based level
  const logger = createLogger({
    level: config.logLevel as LogLevel,
  });

  try {
    validateConfig();

    logger.info("Application starting", { runId });
    logger.info("Configuration loaded", {
      env: config.env,
      debug: config.debug,
      logLevel: config.logLevel,
      appName: config.appName,
    });

    logger.info("Application initialized successfully");
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error("Configuration error", { message: err.message });
      process.exit(1);
    }
    throw err;
  }
}

main();
