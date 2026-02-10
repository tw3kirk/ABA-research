/**
 * Research Specification Tests
 *
 * Run with: npx tsx src/specification/specification.test.ts
 *
 * Tests verification of:
 *   1. Specification creation with atomic topics
 *   2. Index map generation
 *   3. Deep freezing
 *   4. Serialization round-trip
 */

import {
  createSpecification,
  summarizeSpecification,
  serializeSpecification,
  deserializeSpecification,
  SPECIFICATION_VERSION,
} from "./index.js";
import { loadResearchConfig, DEFAULT_RESEARCH_CONFIG } from "../config/index.js";
import type { Topic } from "../topics/schema.js";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);

const SAMPLE_TOPICS: Topic[] = [
  {
    id: "turmeric_helps_redness",
    primaryEntity: "turmeric",
    entityType: "herb",
    claim: {
      direction: "helps",
      mechanism: "contains curcumin which inhibits inflammatory cytokines",
      confidence: "established",
    },
    name: "Turmeric Reduces Skin Redness",
    description: "Turmeric reduces inflammatory markers.",
    condition: "redness_hyperpigmentation",
    category: "ayurvedic_herbs_in_skincare_that_help_skin",
    priority: "high",
    status: "active",
    tags: ["anti-inflammatory"],
  },
  {
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: {
      direction: "harms",
      mechanism: "contains hormones that stimulate sebum production",
      confidence: "emerging",
    },
    name: "Dairy Worsens Acne",
    description: "Dairy consumption associated with increased acne.",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
    priority: "high",
    status: "active",
    tags: ["hormonal"],
  },
  {
    id: "avocado_helps_dryness",
    primaryEntity: "avocado",
    entityType: "food",
    claim: {
      direction: "helps",
      mechanism: "provides monounsaturated fatty acids for skin barrier",
      confidence: "established",
    },
    name: "Avocado Improves Dry Skin",
    description: "Avocado provides healthy fats.",
    condition: "dryness_premature_aging",
    category: "vegan_foods_that_help_skin",
    priority: "medium",
    status: "active",
    tags: ["healthy-fats"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ name, passed: true, message: "OK" });
  } catch (error) {
    results.push({
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════════════

test("Create specification with atomic topics", () => {
  const spec = createSpecification({
    runId: "test-run-001",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    initiatedBy: "test",
    captureGit: false,
  });

  assertEqual(spec.specificationVersion, SPECIFICATION_VERSION, "Version");
  assertEqual(spec.topics.length, 3, "Topic count");
  assertEqual(spec.runMetadata.runId, "test-run-001", "Run ID");
});

test("Topic summaries include atomic fields", () => {
  const spec = createSpecification({
    runId: "test-run-002",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  const summary = spec.topicSummaries.find((s) => s.id === "turmeric_helps_redness")!;

  assertEqual(summary.primaryEntity, "turmeric", "Primary entity");
  assertEqual(summary.entityType, "herb", "Entity type");
  assertEqual(summary.claim.direction, "helps", "Claim direction");
  assert(summary.claim.mechanism !== undefined, "Mechanism present");
});

test("Index maps are generated correctly", () => {
  const spec = createSpecification({
    runId: "test-run-003",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  // Check byCondition index
  const byCondition = new Map(spec.topicIndexes.byCondition);
  assert(byCondition.has("redness_hyperpigmentation"), "Has redness condition");
  assert(byCondition.has("acne_acne_scars"), "Has acne condition");
  assert(byCondition.has("dryness_premature_aging"), "Has dryness condition");

  // Check byEntityType index
  const byEntityType = new Map(spec.topicIndexes.byEntityType);
  assert(byEntityType.has("herb"), "Has herb type");
  assert(byEntityType.has("food"), "Has food type");
  assertEqual(byEntityType.get("food")!.length, 2, "Two food topics");

  // Check byClaimDirection index
  const byDirection = new Map(spec.topicIndexes.byClaimDirection);
  assert(byDirection.has("helps"), "Has helps direction");
  assert(byDirection.has("harms"), "Has harms direction");
  assertEqual(byDirection.get("helps")!.length, 2, "Two helps claims");
  assertEqual(byDirection.get("harms")!.length, 1, "One harms claim");
});

test("Stats include atomic topic breakdowns", () => {
  const spec = createSpecification({
    runId: "test-run-004",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  assertEqual(spec.stats.totalTopics, 3, "Total topics");
  assertEqual(spec.stats.uniqueEntityTypes, 2, "Unique entity types (herb, food)");
  assertEqual(spec.stats.helpsClaims, 2, "Helps claims");
  assertEqual(spec.stats.harmsClaims, 1, "Harms claims");
});

test("Specification is deeply frozen", () => {
  const spec = createSpecification({
    runId: "test-run-005",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  let frozenError = false;
  try {
    (spec as any).stats.totalTopics = 999;
  } catch (e) {
    frozenError = true;
  }
  assert(frozenError, "Modifying spec should throw");

  // Check nested freezing
  let nestedFrozenError = false;
  try {
    (spec.topics[0] as any).primaryEntity = "hacked";
  } catch (e) {
    nestedFrozenError = true;
  }
  assert(nestedFrozenError, "Modifying nested object should throw");
});

test("Serialization round-trip preserves data", () => {
  const spec = createSpecification({
    runId: "test-run-006",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  const json = serializeSpecification(spec);
  const restored = deserializeSpecification(json);

  assertEqual(restored.specificationVersion, spec.specificationVersion, "Version preserved");
  assertEqual(restored.topics.length, spec.topics.length, "Topics preserved");
  assertEqual(restored.stats.helpsClaims, spec.stats.helpsClaims, "Stats preserved");

  // Check index maps preserved
  assertEqual(
    restored.topicIndexes.byClaimDirection.length,
    spec.topicIndexes.byClaimDirection.length,
    "Indexes preserved"
  );
});

test("Summary includes atomic details when requested", () => {
  const spec = createSpecification({
    runId: "test-run-007",
    researchConfig: config,
    topics: SAMPLE_TOPICS,
    captureGit: false,
  });

  const summary = summarizeSpecification(spec, { includeTopics: true, includeIndexes: true });

  assert(summary.includes("Unique entity types:"), "Shows entity type stat");
  assert(summary.includes("Helps claims:"), "Shows helps count");
  assert(summary.includes("Harms claims:"), "Shows harms count");
  assert(summary.includes("By Entity Type:"), "Shows entity type index");
  assert(summary.includes("By Claim Direction:"), "Shows claim direction index");
  assert(summary.includes("Entity: turmeric (herb)"), "Shows atomic topic details");
  assert(summary.includes("Claim: helps"), "Shows claim direction in topic");
});

test("Topics are sorted deterministically by ID", () => {
  // Pass topics in non-sorted order
  const unsortedTopics = [SAMPLE_TOPICS[2]!, SAMPLE_TOPICS[0]!, SAMPLE_TOPICS[1]!];

  const spec = createSpecification({
    runId: "test-run-008",
    researchConfig: config,
    topics: unsortedTopics,
    captureGit: false,
  });

  // Should be sorted alphabetically by ID
  assertEqual(spec.topics[0]!.id, "avocado_helps_dryness", "First topic sorted");
  assertEqual(spec.topics[1]!.id, "dairy_harms_acne", "Second topic sorted");
  assertEqual(spec.topics[2]!.id, "turmeric_helps_redness", "Third topic sorted");
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" Research Specification Tests");
console.log("═══════════════════════════════════════════════════════════════\n");

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;

for (const result of results) {
  const icon = result.passed ? "✓" : "✗";
  const color = result.passed ? "\x1b[32m" : "\x1b[31m";
  console.log(`${color}${icon}\x1b[0m ${result.name}`);
  if (!result.passed) {
    console.log(`  └─ ${result.message}`);
  }
}

console.log("\n───────────────────────────────────────────────────────────────");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("───────────────────────────────────────────────────────────────\n");

// Demo: Show specification summary
console.log("═══════════════════════════════════════════════════════════════");
console.log(" Example: Specification Summary with Atomic Topics");
console.log("═══════════════════════════════════════════════════════════════\n");

const demoSpec = createSpecification({
  runId: "demo-run",
  researchConfig: config,
  topics: SAMPLE_TOPICS,
  captureGit: false,
});

console.log(summarizeSpecification(demoSpec, { includeTopics: true, includeIndexes: true }));

// Exit with error code if any tests failed
if (failed > 0) {
  process.exit(1);
}
