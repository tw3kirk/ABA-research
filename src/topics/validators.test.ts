/**
 * Topic Atomicity Validator Tests
 *
 * Run with: npx tsx src/topics/validators.test.ts
 *
 * These tests verify that the validation guardrails correctly:
 *   1. Accept valid atomic topics
 *   2. Reject topics with multiple entities
 *   3. Reject bucket phrases and vague quantifiers
 *   4. Provide actionable error messages
 */

import {
  validateTopicAtomicity,
  formatValidationIssue,
  formatValidationResult,
  validateTopics,
  type TopicAtomicityResult,
} from "./validators.js";
import type { Topic } from "./schema.js";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valid atomic topic that should pass all checks.
 */
const VALID_TOPIC: Topic = {
  id: "turmeric_helps_redness",
  primaryEntity: "turmeric",
  entityType: "herb",
  claim: {
    direction: "helps",
    mechanism: "contains curcumin which inhibits inflammatory cytokines",
    confidence: "established",
  },
  name: "Turmeric Reduces Skin Redness",
  description: "Turmeric's active compound curcumin reduces inflammatory markers.",
  condition: "redness_hyperpigmentation",
  category: "ayurvedic_herbs_in_skincare_that_help_skin",
  priority: "high",
  status: "active",
  tags: ["anti-inflammatory"],
};

/**
 * Topics that should FAIL validation with specific errors.
 */
const INVALID_TOPICS: Array<{ topic: Topic; expectedRules: string[]; description: string }> = [
  {
    description: "Multiple entities with 'and'",
    expectedRules: ["MULTIPLE_ENTITIES"],
    topic: {
      ...VALID_TOPIC,
      id: "turmeric_and_ginger",
      primaryEntity: "turmeric and ginger",
      name: "Turmeric and Ginger for Skin",
    },
  },
  {
    description: "Multiple entities with comma",
    expectedRules: ["MULTIPLE_ENTITIES"],
    topic: {
      ...VALID_TOPIC,
      id: "herbs_list",
      primaryEntity: "turmeric, ginger, neem",
      name: "Herbs for Skin Health",
    },
  },
  {
    description: "Bucket phrase 'foods that'",
    expectedRules: ["BUCKET_PHRASE"],
    topic: {
      ...VALID_TOPIC,
      id: "vegan_foods_acne",
      primaryEntity: "blueberry",
      name: "Vegan Foods That Reduce Acne",
    },
  },
  {
    description: "Bucket phrase 'herbs for'",
    expectedRules: ["BUCKET_PHRASE"],
    topic: {
      ...VALID_TOPIC,
      id: "herbs_for_skin",
      primaryEntity: "neem",
      name: "Ayurvedic Herbs for Clear Skin",
    },
  },
  {
    description: "Vague quantifier 'various'",
    expectedRules: ["VAGUE_QUANTIFIER"],
    topic: {
      ...VALID_TOPIC,
      id: "various_herbs",
      primaryEntity: "various herbs",
      name: "Various Herbs for Redness",
    },
  },
  {
    description: "Vague quantifier 'some'",
    expectedRules: ["VAGUE_QUANTIFIER"],
    topic: {
      ...VALID_TOPIC,
      id: "some_foods",
      primaryEntity: "some foods",
      name: "Some Foods Help Skin",
    },
  },
  {
    description: "Plural bucket noun 'foods'",
    expectedRules: ["PLURAL_WITHOUT_SPECIFIC"],
    topic: {
      ...VALID_TOPIC,
      id: "foods_for_skin",
      primaryEntity: "anti-inflammatory foods",
      name: "Anti-inflammatory Foods",
    },
  },
  {
    description: "Plural bucket noun 'herbs'",
    expectedRules: ["PLURAL_WITHOUT_SPECIFIC"],
    topic: {
      ...VALID_TOPIC,
      id: "ayurvedic_herbs",
      primaryEntity: "Ayurvedic herbs",
      name: "Ayurvedic Herbs Overview",
    },
  },
  {
    description: "Compound term 'fruits and vegetables'",
    expectedRules: ["COMPOUND_ENTITY"],
    topic: {
      ...VALID_TOPIC,
      id: "fruits_veggies",
      primaryEntity: "fruits and vegetables",
      name: "Fruits and Vegetables for Skin",
    },
  },
  {
    description: "List in name with commas",
    expectedRules: ["LIST_IN_NAME"],
    topic: {
      ...VALID_TOPIC,
      id: "multi_herb",
      primaryEntity: "turmeric",
      name: "Turmeric, Ginger, and Neem Benefits",
    },
  },
];

/**
 * Topics that should generate WARNINGS but still be canonical.
 */
const WARNING_TOPICS: Array<{ topic: Topic; expectedRules: string[]; description: string }> = [
  {
    description: "Multiple mechanisms in claim",
    expectedRules: ["MULTIPLE_CLAIMS"],
    topic: {
      ...VALID_TOPIC,
      id: "turmeric_multi_mechanism",
      claim: {
        direction: "helps",
        mechanism: "reduces inflammation and balances hormones and improves circulation",
        confidence: "emerging",
      },
    },
  },
  {
    description: "Generic category-style name",
    expectedRules: ["GENERIC_CATEGORY_NAME"],
    topic: {
      ...VALID_TOPIC,
      id: "guide_topic",
      name: "Complete Guide to Turmeric for Skin",
    },
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

function assertIncludes(arr: string[], item: string, message: string): void {
  if (!arr.includes(item)) {
    throw new Error(`${message}: expected to include "${item}", got [${arr.join(", ")}]`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST CASES
// ═══════════════════════════════════════════════════════════════════════════

// Test 1: Valid topic passes all checks
test("Valid atomic topic passes validation", () => {
  const result = validateTopicAtomicity(VALID_TOPIC);
  assert(result.isValid, "Expected topic to be valid");
  assert(result.isCanonical, "Expected topic to be canonical");
  assertEqual(result.errorCount, 0, "Error count");
  assertEqual(result.warningCount, 0, "Warning count");
});

// Test 2: Invalid topics are rejected with correct error rules
for (const { topic, expectedRules, description } of INVALID_TOPICS) {
  test(`Rejects: ${description}`, () => {
    const result = validateTopicAtomicity(topic);
    assert(!result.isCanonical, `Expected topic to NOT be canonical`);
    assert(result.errorCount > 0, "Expected at least one error");

    const foundRules = result.issues.map((i) => i.rule);
    for (const rule of expectedRules) {
      assertIncludes(foundRules, rule, `Expected rule ${rule}`);
    }
  });
}

// Test 3: Warning topics are canonical but flagged
for (const { topic, expectedRules, description } of WARNING_TOPICS) {
  test(`Warns: ${description}`, () => {
    const result = validateTopicAtomicity(topic);
    assert(result.isCanonical, "Expected topic to still be canonical with warnings");
    assert(result.warningCount > 0, "Expected at least one warning");

    const foundRules = result.issues.map((i) => i.rule);
    for (const rule of expectedRules) {
      assertIncludes(foundRules, rule, `Expected warning rule ${rule}`);
    }
  });
}

// Test 4: Validation issues have required fields
test("Validation issues have all required fields", () => {
  const invalidTopic = INVALID_TOPICS[0]!.topic;
  const result = validateTopicAtomicity(invalidTopic);
  const issue = result.issues[0]!;

  assert(issue.rule !== undefined, "Issue should have rule");
  assert(issue.severity !== undefined, "Issue should have severity");
  assert(issue.message !== undefined, "Issue should have message");
  assert(issue.reason !== undefined, "Issue should have reason");
  assert(issue.suggestion !== undefined, "Issue should have suggestion");
  assert(issue.fields.length > 0, "Issue should have fields");
});

// Test 5: Validation issues have examples
test("Validation issues include examples", () => {
  const invalidTopic = INVALID_TOPICS[0]!.topic;
  const result = validateTopicAtomicity(invalidTopic);
  const issue = result.issues[0]!;

  assert(issue.example !== undefined, "Issue should have example");
  const example = issue.example!;
  assert(example.before !== undefined, "Example should have before");
  assert(example.after !== undefined, "Example should have after");
});

// Test 6: Format functions produce readable output
test("formatValidationIssue produces readable output", () => {
  const invalidTopic = INVALID_TOPICS[0]!.topic;
  const result = validateTopicAtomicity(invalidTopic);
  const formatted = formatValidationIssue(result.issues[0]!);

  assert(formatted.includes("ERROR"), "Should include severity");
  assert(formatted.includes("REASON:"), "Should include reason label");
  assert(formatted.includes("SUGGESTION:"), "Should include suggestion label");
  assert(formatted.includes("EXAMPLE:"), "Should include example label");
});

// Test 7: formatValidationResult shows pass for valid topic
test("formatValidationResult shows pass for valid topic", () => {
  const result = validateTopicAtomicity(VALID_TOPIC);
  const formatted = formatValidationResult(VALID_TOPIC, result);

  assert(formatted.includes("✓"), "Should include checkmark for valid topic");
  assert(formatted.includes("passes"), "Should indicate passing");
});

// Test 8: validateTopics batch function works
test("validateTopics processes batch correctly", () => {
  const topics = [VALID_TOPIC, INVALID_TOPICS[0]!.topic, INVALID_TOPICS[1]!.topic];
  const { valid, invalid, summary } = validateTopics(topics);

  assertEqual(valid.length, 1, "Valid count");
  assertEqual(invalid.length, 2, "Invalid count");
  assert(summary.includes("Total:   3"), "Summary should show total");
});

// Test 9: Valid plurals are allowed (oats, greens, etc.)
test("Valid plural entities like 'oats' are allowed", () => {
  const oatsTopic: Topic = {
    ...VALID_TOPIC,
    id: "oats_helps_dryness",
    primaryEntity: "oats",
    name: "Oats Soothe Dry Skin",
    condition: "dryness_premature_aging",
    category: "vegan_foods_that_help_skin",
  };

  const result = validateTopicAtomicity(oatsTopic);
  const pluralErrors = result.issues.filter((i) => i.rule === "PLURAL_WITHOUT_SPECIFIC");
  assertEqual(pluralErrors.length, 0, "Should not flag 'oats' as invalid plural");
});

// Test 10: Specific entities with adjectives are valid
test("Specific entities with adjectives are valid", () => {
  const specificTopic: Topic = {
    ...VALID_TOPIC,
    id: "coconut_oil_helps",
    primaryEntity: "virgin coconut oil",
    name: "Virgin Coconut Oil Moisturizes Skin",
    condition: "dryness_premature_aging",
    category: "vegan_foods_that_help_skin",
  };

  const result = validateTopicAtomicity(specificTopic);
  assert(result.isCanonical, "Should allow specific entities with adjectives");
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════");
console.log(" Topic Atomicity Validator Tests");
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

// Demo: Show what a validation failure looks like
console.log("═══════════════════════════════════════════════════════════════");
console.log(" Example Validation Error Output");
console.log("═══════════════════════════════════════════════════════════════\n");

const demoTopic: Topic = {
  ...VALID_TOPIC,
  id: "vegan_foods_acne",
  primaryEntity: "various vegan foods",
  name: "Vegan Foods That Reduce Acne Severity",
  description: "Different plant-based foods that help with acne treatment.",
};

const demoResult = validateTopicAtomicity(demoTopic);
console.log(formatValidationResult(demoTopic, demoResult));

// Exit with error code if any tests failed
if (failed > 0) {
  process.exit(1);
}
