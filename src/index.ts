/**
 * Entry point for ABA research pipeline.
 */

import { config, validateConfig, ConfigError } from "./config/index.js";

function main(): void {
  try {
    validateConfig();
    console.log("Configuration loaded successfully:");
    console.log(`  env:      ${config.env}`);
    console.log(`  debug:    ${config.debug}`);
    console.log(`  logLevel: ${config.logLevel}`);
    console.log(`  appName:  ${config.appName}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

main();
