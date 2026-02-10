/**
 * Tests for topic-aware content constraints.
 *
 * Run: node --import tsx src/standards/topic-constraints.test.ts
 */

import { strict as assert } from "node:assert";
import type { Topic } from "../topics/schema.js";
import type { ContentStandards } from "./content-schema.js";
import type { SeoGuidelines } from "./seo-schema.js";
import {
  deriveTopicConstraints,
  formatConstraintIssues,
  type TopicConstraintsResult,
} from "./topic-constraints.js";
import { loadTopicContentConstraints } from "./loader.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeContentStandards(): ContentStandards {
  return {
    version: "1.0.0",
    name: "Test Standards",
    tone: {
      primary: ["educational", "informative"],
      secondary: [],
      avoid: [],
      perspective: "second_person",
    },
    citations: {
      requireInlineCitations: true,
      format: "numeric",
      requireReferencesSection: true,
      minReferences: 3,
      citationRequiredFor: ["statistics", "medical_claims"],
    },
    forbidden: {
      exactPhrases: [],
      patterns: [],
      forbiddenClaims: [],
      avoidWords: [],
    },
    required: {
      disclaimers: [],
      sections: [],
      elements: [],
    },
    brand: {
      values: ["science-backed"],
      dietaryAlignment: ["vegan"],
      emphasize: ["plant-based ingredients"],
      deemphasize: [],
    },
  };
}

function makeSeoGuidelines(): SeoGuidelines {
  return {
    version: "1.0.0",
    name: "Test SEO",
    appliesTo: ["blog"],
    keywordDensity: {
      primaryKeyword: { min: 1.0, max: 2.5 },
      maxConsecutiveRepetitions: 2,
      minKeywordSpacing: 100,
    },
    headingStructure: {
      requireSingleH1: true,
      h1ContainsKeyword: true,
      minH2Count: 3,
      maxDepth: 4,
      requireProperHierarchy: true,
      keywordInH2Percentage: 40,
      maxHeadingWords: 12,
    },
    contentLength: {
      wordCount: { min: 1200, max: 2500 },
      paragraphWords: { min: 25, max: 150 },
      sentenceWords: { min: 8, max: 25 },
      paragraphsBeforeHeading: 4,
    },
    metaContent: {
      titleLength: { min: 40, max: 60 },
      titleContainsKeyword: true,
      keywordInFirstHalf: true,
      descriptionLength: { min: 140, max: 160 },
      descriptionContainsKeyword: true,
      descriptionRequiresCTA: true,
    },
    linkMedia: {
      internalLinksPerThousandWords: { min: 2, max: 5 },
      externalLinksPerThousandWords: { min: 1, max: 3 },
      requireImageAltText: true,
      altTextContainsKeyword: false,
      imagesPerFiveHundredWords: 1,
    },
    readability: {
      fleschReadingEase: { min: 55, max: 75 },
      maxPassiveVoicePercent: 15,
      maxConsecutiveSameStart: 2,
      requireVariedSentenceLength: true,
    },
  };
}

function makeTopic(overrides: Partial<Topic> & { id: string }): Topic {
  return {
    primaryEntity: "kale",
    entityType: "food",
    claim: { direction: "helps", confidence: "emerging" },
    name: "Kale Calms Skin Redness",
    condition: "redness_hyperpigmentation",
    category: "vegan_foods_that_help_skin",
    priority: "medium",
    status: "active",
    tags: [],
    ...overrides,
  } as Topic;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests: basic derivation
// ---------------------------------------------------------------------------

console.log("\n=== Topic Content Constraints Tests ===\n");
console.log("--- Basic Derivation ---");

test("derives SEO target phrase from entity + condition", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success, `Expected success, got issues: ${JSON.stringify(result.issues)}`);
  assert.equal(result.constraints.length, 1);

  const c = result.constraints[0];
  assert.equal(c.seo.targetPhrase, "kale redness");
  assert.equal(c.seo.primaryKeyword, "kale redness");
});

test("derives email subject intent from entity + direction + condition", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  const c = result.constraints[0];
  assert.equal(c.email.subjectIntent, "how kale helps reduce skin redness");
});

test("derives 'harms' email subject intent correctly", () => {
  const topic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", confidence: "emerging" },
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
    name: "Dairy Worsens Acne",
  });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  const c = result.constraints[0];
  assert.equal(c.seo.targetPhrase, "dairy acne");
  assert.equal(c.email.subjectIntent, "how dairy may worsen acne and acne scars");
});

test("blog keyword set includes primary and secondary keywords", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  const c = result.constraints[0];

  // Primary keyword is first
  assert.equal(c.blog.keywordSet[0], "kale redness");

  // Secondary keywords include entity and condition separately
  assert.ok(c.seo.secondaryKeywords.includes("kale"));
  assert.ok(c.seo.secondaryKeywords.includes("redness"));
  assert.ok(c.seo.secondaryKeywords.includes("kale for redness"));
});

test("food entity type adds 'for skin' secondary keyword", () => {
  const topic = makeTopic({ id: "kale_helps_redness", entityType: "food" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.ok(result.constraints[0].seo.secondaryKeywords.includes("kale for skin"));
});

test("herb entity type adds 'herb for skin' secondary keyword", () => {
  const topic = makeTopic({
    id: "turmeric_helps_redness",
    primaryEntity: "turmeric",
    entityType: "herb",
    category: "ayurvedic_herbs_in_skincare_that_help_skin",
  });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.ok(result.constraints[0].seo.secondaryKeywords.includes("turmeric herb for skin"));
});

test("populates topicId, primaryEntity, claimDirection, condition", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  const c = result.constraints[0];
  assert.equal(c.topicId, "kale_helps_redness");
  assert.equal(c.primaryEntity, "kale");
  assert.equal(c.claimDirection, "helps");
  assert.equal(c.condition, "redness_hyperpigmentation");
});

test("handles multiple topics deterministically", () => {
  const topics = [
    makeTopic({ id: "kale_helps_redness" }),
    makeTopic({
      id: "dairy_harms_acne",
      primaryEntity: "dairy",
      entityType: "food",
      claim: { direction: "harms", confidence: "emerging" },
      condition: "acne_acne_scars",
      category: "animal_ingredients_in_food_that_harm_skin",
      name: "Dairy Worsens Acne",
    }),
  ];
  const result = deriveTopicConstraints(
    topics,
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.equal(result.constraints.length, 2);
  assert.equal(result.constraints[0].topicId, "kale_helps_redness");
  assert.equal(result.constraints[1].topicId, "dairy_harms_acne");
});

// ---------------------------------------------------------------------------
// Tests: guideline rule overrides
// ---------------------------------------------------------------------------

console.log("\n--- Guideline Rule Overrides ---");

test("applies SEO keyword override from matching rule", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      condition: "redness_hyperpigmentation",
      seo: { primaryKeywordOverride: "kale skin redness remedy" },
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(result.success);
  assert.equal(result.constraints[0].seo.primaryKeyword, "kale skin redness remedy");
  assert.equal(result.constraints[0].seo.targetPhrase, "kale skin redness remedy");
});

test("merges additional keywords from matching rule", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      seo: { additionalKeywords: ["kale anti-inflammatory"] },
      blog: { additionalKeywords: ["kale recipe for skin"] },
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(result.success);
  assert.ok(result.constraints[0].seo.secondaryKeywords.includes("kale anti-inflammatory"));
  assert.ok(result.constraints[0].blog.keywordSet.includes("kale recipe for skin"));
});

test("applies email subject override from matching rule", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      email: { subjectIntentOverride: "discover kale's redness-fighting power" },
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(result.success);
  assert.equal(
    result.constraints[0].email.subjectIntent,
    "discover kale's redness-fighting power"
  );
});

test("rule matching by direction only applies to matching topics", () => {
  const helps = makeTopic({ id: "kale_helps_redness" });
  const harms = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", confidence: "emerging" },
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
    name: "Dairy Worsens Acne",
  });
  const rules = [
    {
      direction: "helps" as const,
      seo: { additionalKeywords: ["natural remedy"] },
    },
  ];
  const result = deriveTopicConstraints(
    [helps, harms],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(result.success);
  // "helps" topic gets the extra keyword
  assert.ok(result.constraints[0].seo.secondaryKeywords.includes("natural remedy"));
  // "harms" topic does not
  assert.ok(!result.constraints[1].seo.secondaryKeywords.includes("natural remedy"));
});

// ---------------------------------------------------------------------------
// Tests: validation — invalid entity/condition references
// ---------------------------------------------------------------------------

console.log("\n--- Validation: Invalid References ---");

test("rejects guideline rule referencing non-existent entity", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [{ entity: "spirulina", seo: { additionalKeywords: ["spirulina skin"] } }];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(!result.success);
  const entityIssue = result.issues.find((i) => i.code === "invalid_entity_reference");
  assert.ok(entityIssue, "Expected invalid_entity_reference issue");
  assert.ok(entityIssue!.message.includes("spirulina"));
});

test("warns when guideline rule references unused condition", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  // oily_skin is a valid condition but no topic targets it
  const rules = [{ condition: "oily_skin" as const, seo: { additionalKeywords: ["oily"] } }];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  // Warnings don't block success
  assert.ok(result.success);
  const condIssue = result.issues.find((i) => i.code === "unused_condition_reference");
  assert.ok(condIssue, "Expected unused_condition_reference warning");
});

test("rejects guideline rule with direction contradicting topic", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      condition: "redness_hyperpigmentation" as const,
      direction: "harms" as const,
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(!result.success);
  const dirIssue = result.issues.find((i) => i.code === "direction_contradiction");
  assert.ok(dirIssue, "Expected direction_contradiction issue");
  assert.ok(dirIssue!.message.includes("harms"));
  assert.ok(dirIssue!.message.includes("helps"));
});

test("rejects SEO keyword override that omits entity name", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      seo: { primaryKeywordOverride: "redness remedy" }, // missing "kale"
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(!result.success);
  const seoIssue = result.issues.find((i) => i.code === "seo_entity_mismatch");
  assert.ok(seoIssue, "Expected seo_entity_mismatch issue");
});

test("warns when SEO keyword override omits condition name", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [
    {
      entity: "kale",
      condition: "redness_hyperpigmentation" as const,
      seo: { primaryKeywordOverride: "kale skin benefits" }, // missing "redness"
    },
  ];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  // Warning only, does not block
  assert.ok(result.success);
  const seoIssue = result.issues.find((i) => i.code === "seo_condition_mismatch");
  assert.ok(seoIssue, "Expected seo_condition_mismatch warning");
});

test("rejects malformed guideline rule (missing all targeting fields)", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [{ seo: { additionalKeywords: ["test"] } }]; // no entity/condition/direction
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  assert.ok(!result.success);
  assert.ok(result.issues.some((i) => i.code === "invalid_rule_schema"));
});

// ---------------------------------------------------------------------------
// Tests: SEO contradiction detection
// ---------------------------------------------------------------------------

console.log("\n--- SEO Contradiction Detection ---");

test("detects meta title too short for keyword", () => {
  const topic = makeTopic({
    id: "sls_harms_dryness",
    primaryEntity: "sodium lauryl sulfate",
    entityType: "chemical",
    claim: { direction: "harms", confidence: "established" },
    condition: "dryness_premature_aging",
    category: "skincare_chemicals_that_harm_skin",
    name: "SLS Damages Dry Skin",
  });

  const seo = makeSeoGuidelines();
  // Set max title length very short to trigger conflict
  (seo as any).metaContent.titleLength.max = 10;

  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    seo
  );

  assert.ok(!result.success);
  const issue = result.issues.find((i) => i.code === "seo_title_keyword_overflow");
  assert.ok(issue, "Expected seo_title_keyword_overflow issue");
  assert.ok(issue!.message.includes("sodium lauryl sulfate dry skin"));
});

test("no SEO issues for normal topics with standard guidelines", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.equal(result.issues.length, 0);
});

// ---------------------------------------------------------------------------
// Tests: empty / edge cases
// ---------------------------------------------------------------------------

console.log("\n--- Edge Cases ---");

test("rejects empty topic array", () => {
  const result = deriveTopicConstraints(
    [],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(!result.success);
  assert.ok(result.issues.some((i) => i.code === "empty_topics"));
});

test("works with no guideline rules", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.equal(result.constraints.length, 1);
});

test("works with empty guideline rules array", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    []
  );

  assert.ok(result.success);
  assert.equal(result.constraints.length, 1);
});

// ---------------------------------------------------------------------------
// Tests: loadTopicContentConstraints (loader integration)
// ---------------------------------------------------------------------------

console.log("\n--- Loader Integration ---");

test("loadTopicContentConstraints accepts pre-loaded standards", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const result = loadTopicContentConstraints({
    topics: [topic],
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  assert.ok(result.success);
  assert.equal(result.constraints[0].seo.targetPhrase, "kale redness");
});

// ---------------------------------------------------------------------------
// Tests: formatConstraintIssues
// ---------------------------------------------------------------------------

console.log("\n--- Formatting ---");

test("formatConstraintIssues produces readable output", () => {
  const topic = makeTopic({ id: "kale_helps_redness" });
  const rules = [{ entity: "spirulina" }];
  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines(),
    rules
  );

  const output = formatConstraintIssues(result.issues);
  assert.ok(output.includes("ERRORS:"));
  assert.ok(output.includes("spirulina"));
  assert.ok(output.includes("invalid_entity_reference"));
});

test("formatConstraintIssues handles empty issues", () => {
  const output = formatConstraintIssues([]);
  assert.equal(output, "No issues found.");
});

// ---------------------------------------------------------------------------
// Tests: brand normalization
// ---------------------------------------------------------------------------

console.log("\n--- Brand Normalization ---");

test("plant-based emphasis adds natural keyword for food/herb", () => {
  const topic = makeTopic({ id: "kale_helps_redness", entityType: "food" });
  const standards = makeContentStandards();
  // emphasize includes "plant-based ingredients"
  const result = deriveTopicConstraints(
    [topic],
    standards,
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.ok(
    result.constraints[0].seo.secondaryKeywords.includes("natural kale for redness"),
    "Expected brand-normalized keyword"
  );
});

test("no natural keyword added for chemical entity type", () => {
  const topic = makeTopic({
    id: "sls_harms_dryness",
    primaryEntity: "sulfates",
    entityType: "chemical",
    claim: { direction: "harms", confidence: "established" },
    condition: "dryness_premature_aging",
    category: "skincare_chemicals_that_harm_skin",
    name: "Sulfates Damage Dry Skin",
  });

  const result = deriveTopicConstraints(
    [topic],
    makeContentStandards(),
    makeSeoGuidelines()
  );

  assert.ok(result.success);
  assert.ok(
    !result.constraints[0].seo.secondaryKeywords.some((kw) =>
      kw.startsWith("natural")
    ),
    "Chemical topics should not get natural keyword"
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) {
  process.exit(1);
}
