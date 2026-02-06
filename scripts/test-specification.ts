#!/usr/bin/env node
/**
 * Test script for ResearchSpecification creation and serialization.
 * Demonstrates the full lifecycle from creation to disk persistence.
 */

import { readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  createSpecification,
  saveSpecification,
  loadSpecification,
  serializeSpecification,
  deserializeSpecification,
  summarizeSpecification,
  captureGitState,
  SPECIFICATION_VERSION,
  SpecificationError,
} from "../src/specification/index.js";
import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
} from "../src/config/index.js";
import { loadTopicsOrThrow } from "../src/topics/index.js";
import { generateRunId } from "../src/logging/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPICS_FILE = join(__dirname, "../topics/sample-topics.json");
const TEST_OUTPUT_DIR = join(tmpdir(), "aba-research-test-" + Date.now());

console.log("=== ResearchSpecification Test ===\n");

// Load prerequisites
console.log("1. Loading prerequisites...");
const researchConfig = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
const topicData = JSON.parse(readFileSync(TOPICS_FILE, "utf-8"));
const topics = loadTopicsOrThrow(topicData, researchConfig);
console.log(`   ✓ Loaded ${topics.length} topics`);
console.log(`   ✓ ResearchConfig ready`);

// Test git state capture
console.log("\n2. Testing git state capture...");
const gitState = captureGitState();
if (gitState) {
  console.log(`   ✓ Git state captured:`);
  console.log(`     - Commit: ${gitState.commitShort}`);
  console.log(`     - Branch: ${gitState.branch}`);
  console.log(`     - Dirty: ${gitState.isDirty}`);
} else {
  console.log("   - Git state not available (not in a git repo)");
}

// Create specification
console.log("\n3. Creating ResearchSpecification...");
const runId = generateRunId();
const spec = createSpecification({
  runId,
  researchConfig,
  topics,
  initiatedBy: "test-script",
  context: { testMode: true },
});

console.log(`   ✓ Specification created`);
console.log(`   - Version: ${spec.specificationVersion}`);
console.log(`   - Run ID: ${spec.runMetadata.runId}`);
console.log(`   - Started: ${spec.runMetadata.startedAt}`);
console.log(`   - Total topics: ${spec.stats.totalTopics}`);
console.log(`   - Active topics: ${spec.stats.activeTopics}`);

// Verify immutability
console.log("\n4. Testing immutability...");
try {
  // @ts-expect-error - Testing runtime immutability
  spec.runMetadata.runId = "modified";
  console.log("   ✗ Specification should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Top-level properties are immutable");
}

try {
  // @ts-expect-error - Testing deep immutability
  spec.topics[0].name = "modified";
  console.log("   ✗ Nested objects should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Nested objects are immutable");
}

try {
  // @ts-expect-error - Testing array immutability
  spec.topics.push({ id: "new" });
  console.log("   ✗ Arrays should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Arrays are immutable");
}

// Test serialization round-trip
console.log("\n5. Testing serialization round-trip...");
const json = serializeSpecification(spec);
const restored = deserializeSpecification(json);

// Verify key properties match
const checks = [
  ["specificationVersion", spec.specificationVersion === restored.specificationVersion],
  ["runMetadata.runId", spec.runMetadata.runId === restored.runMetadata.runId],
  ["stats.totalTopics", spec.stats.totalTopics === restored.stats.totalTopics],
  ["topics.length", spec.topics.length === restored.topics.length],
  ["topics[0].id", spec.topics[0].id === restored.topics[0].id],
];

let allMatch = true;
for (const [name, matches] of checks) {
  if (matches) {
    console.log(`   ✓ ${name} matches`);
  } else {
    console.log(`   ✗ ${name} mismatch`);
    allMatch = false;
  }
}

if (!allMatch) {
  console.log("   ✗ Round-trip failed");
  process.exit(1);
}

// Test file persistence
console.log("\n6. Testing file persistence...");
const savedPath = saveSpecification(spec, TEST_OUTPUT_DIR);
console.log(`   ✓ Saved to: ${savedPath}`);

const loaded = loadSpecification(savedPath);
console.log(`   ✓ Loaded from file`);
console.log(`   - Run ID: ${loaded.runMetadata.runId}`);

if (loaded.runMetadata.runId !== spec.runMetadata.runId) {
  console.log("   ✗ File round-trip failed");
  process.exit(1);
}

// Verify loaded spec is also immutable
try {
  // @ts-expect-error - Testing immutability of loaded spec
  loaded.runMetadata.runId = "modified";
  console.log("   ✗ Loaded specification should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Loaded specification is immutable");
}

// Test summary generation
console.log("\n7. Testing summary generation...");
const summary = summarizeSpecification(spec, { includeTopics: false, includeConfig: true });
console.log("   ✓ Summary generated:");
console.log(summary.split("\n").map((line) => `     ${line}`).join("\n"));

// Test version compatibility
console.log("\n8. Testing version compatibility...");
const modifiedJson = json.replace(
  `"specificationVersion": "${SPECIFICATION_VERSION}"`,
  `"specificationVersion": "2.0.0"`
);
try {
  deserializeSpecification(modifiedJson);
  console.log("   ✗ Should reject incompatible version");
  process.exit(1);
} catch (err) {
  if (err instanceof SpecificationError && err.message.includes("Incompatible")) {
    console.log("   ✓ Rejects incompatible specification version");
  } else {
    console.log("   ✗ Wrong error type");
    process.exit(1);
  }
}

// Test invalid JSON handling
console.log("\n9. Testing error handling...");
try {
  deserializeSpecification("not valid json");
  console.log("   ✗ Should reject invalid JSON");
  process.exit(1);
} catch (err) {
  if (err instanceof SpecificationError) {
    console.log("   ✓ Rejects invalid JSON");
  } else {
    throw err;
  }
}

try {
  deserializeSpecification(JSON.stringify({ invalid: true }));
  console.log("   ✗ Should reject invalid schema");
  process.exit(1);
} catch (err) {
  if (err instanceof SpecificationError && err.message.includes("Invalid specification")) {
    console.log("   ✓ Rejects invalid schema");
  } else {
    throw err;
  }
}

// Cleanup
console.log("\n10. Cleaning up...");
try {
  rmSync(TEST_OUTPUT_DIR, { recursive: true });
  console.log(`   ✓ Removed test directory: ${TEST_OUTPUT_DIR}`);
} catch {
  console.log(`   - Could not remove test directory`);
}

// Test topic ordering is deterministic
console.log("\n11. Testing deterministic topic ordering...");
const spec2 = createSpecification({
  runId: generateRunId(),
  researchConfig,
  topics: [...topics].reverse(), // Reverse order
});
const topicIds1 = spec.topics.map((t) => t.id);
const topicIds2 = spec2.topics.map((t) => t.id);
const orderMatch = topicIds1.every((id, i) => id === topicIds2[i]);
if (orderMatch) {
  console.log("   ✓ Topic ordering is deterministic (sorted by ID)");
} else {
  console.log("   ✗ Topic ordering is not deterministic");
  process.exit(1);
}

console.log("\n=== All tests passed ===");
