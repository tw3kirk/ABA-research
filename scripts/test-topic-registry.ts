#!/usr/bin/env node
/**
 * Test script for topic loading and registry indexing.
 * Demonstrates validation, loading, and index access patterns.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadTopics,
  loadTopicsOrThrow,
  TopicRegistry,
  TopicValidationError,
} from "../src/topics/index.js";
import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
} from "../src/config/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPICS_FILE = join(__dirname, "../topics/sample-topics.json");

console.log("=== Topic Registry Test ===\n");

// Load research config first
console.log("1. Loading ResearchConfig...");
const researchConfig = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
console.log("   ✓ ResearchConfig loaded");
console.log(`   - Supported conditions: ${researchConfig.supportedConditions.length}`);
console.log(`   - Supported categories: ${researchConfig.supportedCategories.length}`);

// Load topic data from JSON
console.log("\n2. Loading topics from JSON...");
const topicData = JSON.parse(readFileSync(TOPICS_FILE, "utf-8"));
console.log(`   - Found ${topicData.topics.length} topics in file`);

// Validate and load topics
console.log("\n3. Validating topics against ResearchConfig...");
const topics = loadTopicsOrThrow(topicData, researchConfig);
console.log(`   ✓ All ${topics.length} topics validated successfully`);

// Create registry
console.log("\n4. Creating TopicRegistry with indexes...");
const registry = TopicRegistry.create(topics);
const stats = registry.getStats();
console.log("   ✓ Registry created with indexes:");
console.log(`   - Total topics: ${stats.totalTopics}`);
console.log(`   - Unique conditions: ${stats.uniqueConditions}`);
console.log(`   - Unique categories: ${stats.uniqueCategories}`);
console.log(`   - Unique combinations: ${stats.uniqueCombinations}`);
console.log(`   - By status: active=${stats.byStatus.active}, draft=${stats.byStatus.draft}`);
console.log(`   - By priority: high=${stats.byPriority.high}, medium=${stats.byPriority.medium}, low=${stats.byPriority.low}`);

// Test index access
console.log("\n5. Testing index access patterns...");

// By condition
const acneTopics = registry.getByCondition("acne");
console.log(`\n   getByCondition("acne"): ${acneTopics.length} topics`);
for (const topic of acneTopics) {
  console.log(`     - ${topic.id}: ${topic.name}`);
}

// By category
const treatmentTopics = registry.getByCategory("treatment_options");
console.log(`\n   getByCategory("treatment_options"): ${treatmentTopics.length} topics`);
for (const topic of treatmentTopics) {
  console.log(`     - ${topic.id}: ${topic.condition}`);
}

// By condition + category
const eczemaPreventionTopics = registry.getByConditionAndCategory("eczema", "prevention");
console.log(`\n   getByConditionAndCategory("eczema", "prevention"): ${eczemaPreventionTopics.length} topics`);
for (const topic of eczemaPreventionTopics) {
  console.log(`     - ${topic.id}: ${topic.name}`);
}

// Filter with multiple criteria
const highPriorityActive = registry.filter({ priority: "high", status: "active" });
console.log(`\n   filter({ priority: "high", status: "active" }): ${highPriorityActive.length} topics`);
for (const topic of highPriorityActive) {
  console.log(`     - ${topic.id}`);
}

// Test direct lookup
console.log("\n6. Testing direct lookup...");
const directLookup = registry.getById("acne_treatment_options");
if (directLookup) {
  console.log(`   ✓ getById("acne_treatment_options"): ${directLookup.name}`);
} else {
  console.log("   ✗ Direct lookup failed");
  process.exit(1);
}

// Test deterministic ordering
console.log("\n7. Testing deterministic ordering...");
const allIds = registry.topics.map((t) => t.id);
const sortedIds = [...allIds].sort();
const isOrdered = allIds.every((id, i) => id === sortedIds[i]);
if (isOrdered) {
  console.log("   ✓ Topics are sorted alphabetically by ID");
} else {
  console.log("   ✗ Topics are not in deterministic order");
  process.exit(1);
}

// Test immutability
console.log("\n8. Testing immutability...");
try {
  const topic = registry.topics[0];
  // @ts-expect-error - Testing runtime immutability
  topic.name = "Modified";
  console.log("   ✗ Topics should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Topics are immutable");
}

// Test validation errors
console.log("\n9. Testing validation error handling...");

// Invalid condition
const invalidCondition = {
  version: "1.0.0",
  topics: [{
    id: "invalid_condition_topic",
    name: "Invalid",
    condition: "not_a_real_condition",
    category: "treatment_options",
  }],
};
const invalidResult = loadTopics(invalidCondition, researchConfig);
if (!invalidResult.success && invalidResult.errors) {
  console.log("   ✓ Invalid condition rejected:");
  console.log(`     - ${invalidResult.errors[0].message.substring(0, 80)}...`);
} else {
  console.log("   ✗ Should have rejected invalid condition");
  process.exit(1);
}

// Unsupported category (not in ResearchConfig)
const restrictedConfig = loadResearchConfig({
  ...DEFAULT_RESEARCH_CONFIG,
  supportedCategories: ["treatment_options"], // Only one category
});
const categoryMismatch = {
  version: "1.0.0",
  topics: [{
    id: "category_mismatch",
    name: "Category Mismatch",
    condition: "acne",
    category: "pathophysiology", // Not in restricted config
  }],
};
const mismatchResult = loadTopics(categoryMismatch, restrictedConfig);
if (!mismatchResult.success && mismatchResult.errors) {
  console.log("   ✓ Category not in ResearchConfig rejected:");
  console.log(`     - ${mismatchResult.errors[0].message.substring(0, 80)}...`);
} else {
  console.log("   ✗ Should have rejected unsupported category");
  process.exit(1);
}

// Duplicate IDs
const duplicateIds = {
  version: "1.0.0",
  topics: [
    { id: "duplicate_id", name: "First", condition: "acne", category: "treatment_options" },
    { id: "duplicate_id", name: "Second", condition: "eczema", category: "prevention" },
  ],
};
const duplicateResult = loadTopics(duplicateIds, researchConfig);
if (!duplicateResult.success && duplicateResult.errors?.some(e => e.type === "duplicate")) {
  console.log("   ✓ Duplicate topic IDs rejected");
} else {
  console.log("   ✗ Should have rejected duplicate IDs");
  process.exit(1);
}

// Test available keys
console.log("\n10. Listing available index keys...");
console.log(`   Conditions: ${registry.getConditions().join(", ")}`);
console.log(`   Categories: ${registry.getCategories().join(", ")}`);
console.log(`   Combinations: ${registry.getConditionCategoryKeys().length} keys`);

console.log("\n=== All tests passed ===");
