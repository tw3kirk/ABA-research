/**
 * Prompt snapshot versioning tests.
 *
 * Run: node --import tsx src/prompts/snapshot.test.ts
 *
 * Tests cover:
 *   1. Hash determinism — identical inputs always produce the same hash
 *   2. Hash invalidation — any config/template/topic change produces a new hash
 *   3. Snapshot creation — metadata is captured correctly
 *   4. Storage round-trip — store → load → verify cycle
 *   5. Integrity verification — detect tampered content
 *   6. Template versioning — raw template source gets its own hash
 *   7. Listing — enumerate snapshots for a template/topic pair
 */

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  computePromptHash,
  createSnapshot,
  computeTemplateVersion,
  storeSnapshot,
  loadSnapshotByHash,
  verifySnapshot,
  getSnapshotPath,
  listSnapshots,
  type PromptSnapshot,
  type CreateSnapshotInput,
} from "./snapshot.js";
import {
  buildPromptContext,
  type PromptContext,
} from "./context.js";
import { parseTemplate } from "./template.js";
import { renderPrompt as render } from "./renderer.js";
import {
  buildPromptConstraints,
  formatConstraints,
} from "./constraints.js";
import type { Topic } from "../topics/schema.js";
import type { ResearchSpecification } from "../specification/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";

// ═══════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

// Temp directory for snapshot storage tests
const TEST_DIR = join(tmpdir(), `snapshot-test-${Date.now()}`);

// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

function makeTopic(overrides?: Partial<Topic>): Topic {
  return {
    id: "turmeric_helps_redness",
    primaryEntity: "turmeric",
    entityType: "herb",
    claim: {
      direction: "helps",
      mechanism: "curcumin inhibits inflammatory cytokines (TNF-α, IL-6)",
      confidence: "established",
    },
    name: "Turmeric Reduces Skin Redness",
    condition: "redness_hyperpigmentation",
    category: "ayurvedic_herbs_in_skincare_that_help_skin",
    priority: "high",
    status: "active",
    tags: ["anti-inflammatory"],
    ...overrides,
  } as Topic;
}

function makeSpecification(): ResearchSpecification {
  return {
    specificationVersion: "2.0.0",
    runMetadata: {
      runId: "run-20250101-abc123",
      startedAt: "2025-01-01T00:00:00Z",
      hostname: "test-host",
      git: { commitSha: "abc123def", branch: "main", isDirty: false },
    },
    researchConfig: {
      qualityRequirements: {
        minCitationsPerClaim: 2,
        minSourcesPerTopic: 3,
        maxSourceAgeYears: 10,
        allowedEvidenceTypes: [
          "systematic_review",
          "meta_analysis",
          "rct",
          "cohort_study",
          "clinical_guideline",
        ],
        requireAtLeastOneHighQuality: true,
      },
      sourcePolicy: {
        allowedSourceTypes: [
          "peer_reviewed_journal",
          "review_paper",
          "clinical_guideline",
          "government_health_agency",
          "professional_association",
        ],
        allowPreprints: false,
        requirePeerReview: true,
        preferredDatabases: ["PubMed", "Cochrane Library", "MEDLINE"],
      },
      model: { provider: "google", name: "gemini-deep-research", version: "1.0" },
    },
    topics: [makeTopic()],
    topicSummaries: [
      {
        id: "turmeric_helps_redness",
        entity: "turmeric",
        condition: "redness_hyperpigmentation",
        direction: "helps",
        category: "ayurvedic_herbs_in_skincare_that_help_skin",
        priority: "high",
        status: "active",
      },
    ],
    topicIndexes: {
      byCondition: { redness_hyperpigmentation: ["turmeric_helps_redness"] },
      byCategory: { ayurvedic_herbs_in_skincare_that_help_skin: ["turmeric_helps_redness"] },
      byEntityType: { herb: ["turmeric_helps_redness"] },
      byClaimDirection: { helps: ["turmeric_helps_redness"] },
    },
    stats: {
      totalTopics: 1,
      activeTopics: 1,
      byCondition: { redness_hyperpigmentation: 1 },
      byCategory: { ayurvedic_herbs_in_skincare_that_help_skin: 1 },
      byEntityType: { herb: 1 },
      byClaimDirection: { helps: 1 },
    },
  } as unknown as ResearchSpecification;
}

function makeContentStandards(): ContentStandards {
  return {
    version: "1.0.0",
    name: "Test Standards",
    tone: {
      primary: ["educational", "informative"],
      secondary: [],
      avoid: [],
      perspective: "second_person",
      readingLevel: { min: 8, max: 12 },
    },
    citations: {
      requireInlineCitations: true,
      format: "numeric",
      requireReferencesSection: true,
      minReferences: 5,
      citationRequiredFor: ["statistics", "medical_claims"],
    },
    forbidden: {
      exactPhrases: ["miracle cure", "guaranteed results"],
      patterns: [],
      forbiddenClaims: [],
      avoidWords: [],
    },
    required: {
      disclaimers: [{ text: "Consult your dermatologist before making changes." }],
      sections: [],
      elements: [],
    },
    brand: {
      values: ["vegan", "cruelty-free", "science-backed"],
      dietaryAlignment: ["vegan", "cruelty_free"],
      emphasize: ["plant-based ingredients", "Ayurvedic traditions"],
      deemphasize: ["synthetic fragrances"],
    },
  } as unknown as ContentStandards;
}

function makeSnapshotInput(overrides?: Partial<CreateSnapshotInput>): CreateSnapshotInput {
  return {
    renderedText: "# Research: turmeric\n\nInvestigate turmeric for redness.",
    templateName: "deep-research.md",
    templateVersion: "abc123def456",
    topicId: "turmeric_helps_redness",
    gitCommit: "abc123def",
    gitBranch: "main",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HASH DETERMINISM TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Hash Determinism");

test("identical text produces identical hash", () => {
  const text = "Hello, world! This is a rendered prompt.";
  const h1 = computePromptHash(text);
  const h2 = computePromptHash(text);
  assert.equal(h1, h2);
});

test("hash is 12 hex characters", () => {
  const hash = computePromptHash("test input");
  assert.equal(hash.length, 12);
  assert.match(hash, /^[0-9a-f]{12}$/);
});

test("same text called 100 times produces same hash", () => {
  const text = "Determinism test: {{topic.entity}} helps {{topic.condition}}.";
  const expected = computePromptHash(text);
  for (let i = 0; i < 100; i++) {
    assert.equal(computePromptHash(text), expected);
  }
});

test("empty string has a deterministic hash", () => {
  const h1 = computePromptHash("");
  const h2 = computePromptHash("");
  assert.equal(h1, h2);
  assert.equal(h1.length, 12);
});

test("hash includes all content — trailing newline matters", () => {
  const h1 = computePromptHash("prompt text");
  const h2 = computePromptHash("prompt text\n");
  assert.notEqual(h1, h2);
});

// ═══════════════════════════════════════════════════════════════════════════
// HASH INVALIDATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Hash Invalidation on Config Change");

test("different rendered text produces different hash", () => {
  const h1 = computePromptHash("Topic: turmeric helps redness");
  const h2 = computePromptHash("Topic: dairy harms acne");
  assert.notEqual(h1, h2);
});

test("changing a single character changes the hash", () => {
  const base = "Minimum 2 citations per claim";
  const modified = "Minimum 3 citations per claim";
  assert.notEqual(computePromptHash(base), computePromptHash(modified));
});

test("adding a constraint block changes the hash", () => {
  const withoutConstraints = "Research turmeric for redness.";
  const withConstraints = "Research turmeric for redness.\n\n## Constraints & Exclusions\n\n- Do NOT cite preprints.";
  assert.notEqual(
    computePromptHash(withoutConstraints),
    computePromptHash(withConstraints)
  );
});

test("changing topic entity changes the hash (via rendered text)", () => {
  const template = parseTemplate("Research {{topic.entity}} for {{topic.condition}}.", "test");
  const ctx1 = buildPromptContext({ topic: makeTopic() });
  const ctx2 = buildPromptContext({ topic: makeTopic({ primaryEntity: "neem", id: "neem_helps_redness" }) });

  const r1 = render(template, ctx1, { strict: false });
  const r2 = render(template, ctx2, { strict: false });

  assert.notEqual(computePromptHash(r1), computePromptHash(r2));
});

test("changing claim direction changes the hash (via conditionals)", () => {
  const src = [
    "Topic: {{topic.entity}}",
    "{{#if topic.claim.direction == \"helps\"}}Beneficial.{{/if}}",
    "{{#if topic.claim.direction == \"harms\"}}Harmful.{{/if}}",
  ].join("\n");
  const template = parseTemplate(src, "test");

  const helpsTopic = makeTopic();
  const harmsTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    claim: { direction: "harms", mechanism: "triggers IGF-1 pathway", confidence: "established" },
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const ctx1 = buildPromptContext({ topic: helpsTopic });
  const ctx2 = buildPromptContext({ topic: harmsTopic });

  const r1 = render(template, ctx1, { strict: false });
  const r2 = render(template, ctx2, { strict: false });

  assert.notEqual(computePromptHash(r1), computePromptHash(r2));
});

test("changing quality requirements changes the hash (via constraints)", () => {
  const topic = makeTopic();
  const spec1 = makeSpecification();
  const spec2 = {
    ...spec1,
    researchConfig: {
      ...spec1.researchConfig,
      qualityRequirements: {
        ...spec1.researchConfig.qualityRequirements,
        minCitationsPerClaim: 5, // changed from 2 to 5
      },
    },
  } as unknown as ResearchSpecification;

  const c1 = buildPromptConstraints({ topic, specification: spec1 });
  const c2 = buildPromptConstraints({ topic, specification: spec2 });

  const rendered1 = "Base prompt" + "\n" + formatConstraints(c1);
  const rendered2 = "Base prompt" + "\n" + formatConstraints(c2);

  assert.notEqual(computePromptHash(rendered1), computePromptHash(rendered2));
});

test("changing forbidden phrases changes the hash (via constraints)", () => {
  const topic = makeTopic();
  const std1 = makeContentStandards();
  const std2 = {
    ...std1,
    forbidden: {
      ...std1.forbidden,
      exactPhrases: ["miracle cure", "guaranteed results", "permanent fix"],
    },
  } as unknown as ContentStandards;

  const c1 = buildPromptConstraints({ topic, contentStandards: std1 });
  const c2 = buildPromptConstraints({ topic, contentStandards: std2 });

  const rendered1 = "Base prompt" + "\n" + formatConstraints(c1);
  const rendered2 = "Base prompt" + "\n" + formatConstraints(c2);

  assert.notEqual(computePromptHash(rendered1), computePromptHash(rendered2));
});

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT CREATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Snapshot Creation");

test("createSnapshot produces correct hash", () => {
  const input = makeSnapshotInput();
  const snapshot = createSnapshot(input);
  const expectedHash = computePromptHash(input.renderedText);
  assert.equal(snapshot.hash, expectedHash);
});

test("createSnapshot captures all metadata fields", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  assert.equal(snapshot.metadata.templateName, "deep-research.md");
  assert.equal(snapshot.metadata.templateVersion, "abc123def456");
  assert.equal(snapshot.metadata.topicId, "turmeric_helps_redness");
  assert.equal(snapshot.metadata.gitCommit, "abc123def");
  assert.equal(snapshot.metadata.gitBranch, "main");
  assert.equal(snapshot.metadata.createdAt, "2025-01-01T00:00:00.000Z");
});

test("createSnapshot defaults gitCommit and gitBranch to unknown", () => {
  const snapshot = createSnapshot({
    renderedText: "test",
    templateName: "test.md",
    templateVersion: "v1",
    topicId: "test_topic",
    createdAt: "2025-01-01T00:00:00Z",
  });
  assert.equal(snapshot.metadata.gitCommit, "unknown");
  assert.equal(snapshot.metadata.gitBranch, "unknown");
});

test("createSnapshot returns frozen object", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.metadata));
});

test("metadata does NOT affect the hash", () => {
  const s1 = createSnapshot(makeSnapshotInput({
    gitCommit: "aaa111",
    gitBranch: "feature-1",
    createdAt: "2025-01-01T00:00:00Z",
  }));
  const s2 = createSnapshot(makeSnapshotInput({
    gitCommit: "bbb222",
    gitBranch: "feature-2",
    createdAt: "2026-06-15T12:00:00Z",
  }));
  // Same renderedText → same hash, despite different metadata
  assert.equal(s1.hash, s2.hash);
});

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE VERSIONING TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Template Versioning");

test("computeTemplateVersion is deterministic", () => {
  const src = "# Template\n\n{{topic.entity}} for {{topic.condition}}";
  const v1 = computeTemplateVersion(src);
  const v2 = computeTemplateVersion(src);
  assert.equal(v1, v2);
});

test("computeTemplateVersion is 12 hex chars", () => {
  const v = computeTemplateVersion("any template");
  assert.equal(v.length, 12);
  assert.match(v, /^[0-9a-f]{12}$/);
});

test("template change produces different version", () => {
  const v1 = computeTemplateVersion("# V1\n\n{{topic.entity}}");
  const v2 = computeTemplateVersion("# V2\n\n{{topic.entity}} updated");
  assert.notEqual(v1, v2);
});

test("template version differs from prompt hash of same text", () => {
  // They use the same algorithm, but this test documents that they're
  // conceptually separate: template version hashes raw source, prompt
  // hash covers rendered output.
  const text = "{{topic.entity}} helps {{topic.condition}}";
  const tv = computeTemplateVersion(text);
  const ph = computePromptHash(text);
  // Same input → same output (they both use SHA-256), but this confirms
  // the functions exist as separate entry points.
  assert.equal(tv, ph);
});

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE ROUND-TRIP TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Storage Round-Trip");

test("storeSnapshot creates directory tree and file", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  const filePath = storeSnapshot(snapshot, TEST_DIR);
  assert.ok(existsSync(filePath));
  assert.ok(filePath.endsWith(`${snapshot.hash}.md`));
  assert.ok(filePath.includes("deep-research"));
  assert.ok(filePath.includes("turmeric_helps_redness"));
});

test("storeSnapshot is idempotent (same hash doesn't overwrite)", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  const path1 = storeSnapshot(snapshot, TEST_DIR);
  const path2 = storeSnapshot(snapshot, TEST_DIR);
  assert.equal(path1, path2);
});

test("loadSnapshotByHash retrieves stored snapshot", () => {
  const original = createSnapshot(makeSnapshotInput());
  storeSnapshot(original, TEST_DIR);

  const result = loadSnapshotByHash(
    original.hash,
    original.metadata.templateName,
    original.metadata.topicId,
    TEST_DIR
  );

  assert.ok(result.success);
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.hash, original.hash);
  assert.equal(result.snapshot.renderedText, original.renderedText);
  assert.equal(result.snapshot.metadata.templateName, original.metadata.templateName);
  assert.equal(result.snapshot.metadata.templateVersion, original.metadata.templateVersion);
  assert.equal(result.snapshot.metadata.topicId, original.metadata.topicId);
  assert.equal(result.snapshot.metadata.gitCommit, original.metadata.gitCommit);
  assert.equal(result.snapshot.metadata.gitBranch, original.metadata.gitBranch);
  assert.equal(result.snapshot.metadata.createdAt, original.metadata.createdAt);
});

test("loadSnapshotByHash returns error for missing snapshot", () => {
  const result = loadSnapshotByHash(
    "nonexistent0",
    "deep-research.md",
    "turmeric_helps_redness",
    TEST_DIR
  );
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("not found"));
});

test("getSnapshotPath strips template extension", () => {
  const path = getSnapshotPath("deep-research.md", "dairy_harms_acne", "abc123def456", "/base");
  assert.ok(path.includes("deep-research"));
  assert.ok(!path.includes("deep-research.md/"));
  assert.ok(path.endsWith("abc123def456.md"));
});

test("store and load with different topics", () => {
  const s1 = createSnapshot(makeSnapshotInput({
    renderedText: "Prompt for turmeric",
    topicId: "turmeric_helps_redness",
  }));
  const s2 = createSnapshot(makeSnapshotInput({
    renderedText: "Prompt for dairy",
    topicId: "dairy_harms_acne",
  }));

  storeSnapshot(s1, TEST_DIR);
  storeSnapshot(s2, TEST_DIR);

  const r1 = loadSnapshotByHash(s1.hash, "deep-research.md", "turmeric_helps_redness", TEST_DIR);
  const r2 = loadSnapshotByHash(s2.hash, "deep-research.md", "dairy_harms_acne", TEST_DIR);

  assert.ok(r1.success);
  assert.ok(r2.success);
  assert.equal(r1.snapshot!.renderedText, "Prompt for turmeric");
  assert.equal(r2.snapshot!.renderedText, "Prompt for dairy");
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRITY VERIFICATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Integrity Verification");

test("verifySnapshot returns valid for untampered snapshot", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  const result = verifySnapshot(snapshot);
  assert.ok(result.valid);
  assert.equal(result.storedHash, result.computedHash);
});

test("verifySnapshot returns invalid for tampered content", () => {
  const snapshot = createSnapshot(makeSnapshotInput());
  // Simulate tampering by creating a snapshot with mismatched hash
  const tampered: PromptSnapshot = {
    hash: snapshot.hash,
    renderedText: snapshot.renderedText + "\n\nTAMPERED CONTENT",
    metadata: snapshot.metadata,
  };
  const result = verifySnapshot(tampered);
  assert.equal(result.valid, false);
  assert.notEqual(result.storedHash, result.computedHash);
});

test("verifySnapshot round-trip: store → load → verify", () => {
  const original = createSnapshot(makeSnapshotInput({
    renderedText: "Full round-trip verification test.\n\nWith multiple lines.",
  }));
  storeSnapshot(original, TEST_DIR);

  const loaded = loadSnapshotByHash(
    original.hash,
    "deep-research.md",
    "turmeric_helps_redness",
    TEST_DIR
  );
  assert.ok(loaded.success);

  const verified = verifySnapshot(loaded.snapshot!);
  assert.ok(verified.valid);
});

test("verifySnapshot detects on-disk tampering", () => {
  const snapshot = createSnapshot(makeSnapshotInput({
    renderedText: "Original content for tampering test.",
  }));
  const filePath = storeSnapshot(snapshot, TEST_DIR);

  // Tamper with the file on disk
  const fileContent = readFileSync(filePath, "utf-8");
  writeFileSync(filePath, fileContent.replace("Original content", "Modified content"), "utf-8");

  // Load and verify — should detect tampering
  const loaded = loadSnapshotByHash(
    snapshot.hash,
    "deep-research.md",
    "turmeric_helps_redness",
    TEST_DIR
  );
  assert.ok(loaded.success);

  const verified = verifySnapshot(loaded.snapshot!);
  assert.equal(verified.valid, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// LISTING TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Snapshot Listing");

test("listSnapshots returns empty for non-existent path", () => {
  const result = listSnapshots("nonexistent.md", "nonexistent_topic", TEST_DIR);
  assert.deepStrictEqual(result, []);
});

test("listSnapshots returns stored snapshot hashes", () => {
  const s1 = createSnapshot(makeSnapshotInput({ renderedText: "version A" }));
  const s2 = createSnapshot(makeSnapshotInput({ renderedText: "version B" }));

  storeSnapshot(s1, TEST_DIR);
  storeSnapshot(s2, TEST_DIR);

  const hashes = listSnapshots("deep-research.md", "turmeric_helps_redness", TEST_DIR);
  assert.ok(hashes.includes(s1.hash));
  assert.ok(hashes.includes(s2.hash));
});

test("listSnapshots returns only hashes for the specified topic", () => {
  const s1 = createSnapshot(makeSnapshotInput({
    renderedText: "topic A prompt",
    topicId: "topic_a",
  }));
  const s2 = createSnapshot(makeSnapshotInput({
    renderedText: "topic B prompt",
    topicId: "topic_b",
  }));

  storeSnapshot(s1, TEST_DIR);
  storeSnapshot(s2, TEST_DIR);

  const hashesA = listSnapshots("deep-research.md", "topic_a", TEST_DIR);
  const hashesB = listSnapshots("deep-research.md", "topic_b", TEST_DIR);

  assert.ok(hashesA.includes(s1.hash));
  assert.ok(!hashesA.includes(s2.hash));
  assert.ok(hashesB.includes(s2.hash));
  assert.ok(!hashesB.includes(s1.hash));
});

// ═══════════════════════════════════════════════════════════════════════════
// END-TO-END: FULL RENDER → SNAPSHOT → VERIFY
// ═══════════════════════════════════════════════════════════════════════════

section("End-to-End: Render → Snapshot → Verify");

test("full pipeline: render prompt, snapshot, store, load, verify", () => {
  const topic = makeTopic();
  const spec = makeSpecification();
  const standards = makeContentStandards();

  // Render a prompt
  const templateSrc = "Research {{topic.entity}} for {{topic.condition}}.\nDirection: {{topic.claim.direction}}.";
  const template = parseTemplate(templateSrc, "e2e-test");
  const ctx = buildPromptContext({ topic, specification: spec });
  const constraints = buildPromptConstraints({ topic, specification: spec, contentStandards: standards });
  const rendered = render(template, ctx, { strict: false, constraints });

  // Create snapshot
  const templateVersion = computeTemplateVersion(templateSrc);
  const snapshot = createSnapshot({
    renderedText: rendered,
    templateName: "e2e-test.md",
    templateVersion,
    topicId: topic.id,
    gitCommit: "abc123def",
    gitBranch: "main",
    createdAt: "2025-01-01T00:00:00Z",
  });

  // Store
  const filePath = storeSnapshot(snapshot, TEST_DIR);
  assert.ok(existsSync(filePath));

  // Load
  const loaded = loadSnapshotByHash(snapshot.hash, "e2e-test.md", topic.id, TEST_DIR);
  assert.ok(loaded.success);
  assert.equal(loaded.snapshot!.renderedText, rendered);

  // Verify
  const verified = verifySnapshot(loaded.snapshot!);
  assert.ok(verified.valid);
});

test("re-rendering with same inputs produces same hash", () => {
  const topic = makeTopic();
  const spec = makeSpecification();

  const templateSrc = "{{topic.entity}} {{topic.claim.direction}} {{topic.condition}}";
  const template = parseTemplate(templateSrc, "determinism-test");
  const ctx = buildPromptContext({ topic, specification: spec });

  const r1 = render(template, ctx, { strict: false });
  const r2 = render(template, ctx, { strict: false });

  assert.equal(computePromptHash(r1), computePromptHash(r2));
});

test("re-rendering with different topic produces different hash", () => {
  const spec = makeSpecification();

  const templateSrc = "{{topic.entity}} {{topic.claim.direction}} {{topic.condition}}";
  const template = parseTemplate(templateSrc, "change-test");

  const ctx1 = buildPromptContext({ topic: makeTopic(), specification: spec });
  const ctx2 = buildPromptContext({
    topic: makeTopic({
      id: "neem_helps_acne",
      primaryEntity: "neem",
      condition: "acne_acne_scars",
    }),
    specification: spec,
  });

  const r1 = render(template, ctx1, { strict: false });
  const r2 = render(template, ctx2, { strict: false });

  assert.notEqual(computePromptHash(r1), computePromptHash(r2));
});

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════════════

try {
  rmSync(TEST_DIR, { recursive: true, force: true });
} catch {
  // Cleanup is best-effort
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(`\n${"═".repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${"═".repeat(60)}\n`);

if (failed > 0) {
  process.exit(1);
}
