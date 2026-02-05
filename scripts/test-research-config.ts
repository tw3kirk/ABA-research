#!/usr/bin/env node
/**
 * Test script for research configuration loading and validation.
 * Demonstrates successful loading and fail-fast validation errors.
 */

import {
  loadResearchConfig,
  validateResearchConfig,
  ResearchConfigError,
  DEFAULT_RESEARCH_CONFIG,
} from "../src/config/research/index.js";

console.log("=== Research Config Test ===\n");

// Test 1: Load default config successfully
console.log("1. Loading default config...");
try {
  const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
  console.log("   ✓ Default config loaded successfully");
  console.log(`   - Supported conditions: ${config.supportedConditions.length}`);
  console.log(`   - Output formats: ${config.allowedOutputFormats.join(", ")}`);
  console.log(`   - Min citations per claim: ${config.qualityRequirements.minCitationsPerClaim}`);
  console.log(`   - Schema version: ${config.modelMetadata.configSchemaVersion}`);
} catch (err) {
  console.log("   ✗ Failed to load default config");
  console.error(err);
  process.exit(1);
}

// Test 2: Verify immutability
console.log("\n2. Testing immutability...");
try {
  const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
  // @ts-expect-error - Testing runtime immutability
  config.supportedConditions = [];
  console.log("   ✗ Config should be immutable but was modified");
  process.exit(1);
} catch (err) {
  console.log("   ✓ Config is immutable (modification threw error)");
}

// Test 3: Validate invalid config (missing fields)
console.log("\n3. Testing validation with missing fields...");
const invalidConfig1 = {
  supportedConditions: ["acne"],
  // Missing other required fields
};
const result1 = validateResearchConfig(invalidConfig1);
if (!result1.success && result1.errors) {
  console.log(`   ✓ Validation correctly failed with ${result1.errors.length} errors`);
  console.log(`   - First error: ${result1.errors[0].path.join(".")} - ${result1.errors[0].message}`);
} else {
  console.log("   ✗ Validation should have failed");
  process.exit(1);
}

// Test 4: Validate invalid config (wrong enum value)
console.log("\n4. Testing validation with invalid enum value...");
const invalidConfig2 = {
  ...DEFAULT_RESEARCH_CONFIG,
  supportedConditions: ["invalid_condition"],
};
const result2 = validateResearchConfig(invalidConfig2);
if (!result2.success && result2.errors) {
  console.log(`   ✓ Validation correctly rejected invalid enum value`);
  console.log(`   - Error: ${result2.errors[0].message}`);
} else {
  console.log("   ✗ Validation should have rejected invalid enum");
  process.exit(1);
}

// Test 5: Test ResearchConfigError formatting
console.log("\n5. Testing error formatting...");
try {
  loadResearchConfig({ invalid: true });
} catch (err) {
  if (err instanceof ResearchConfigError) {
    console.log("   ✓ ResearchConfigError thrown with formatted message:");
    console.log(err.format().split("\n").map(line => `     ${line}`).join("\n"));
  } else {
    console.log("   ✗ Wrong error type thrown");
    process.exit(1);
  }
}

console.log("\n=== All tests passed ===");
