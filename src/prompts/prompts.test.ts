/**
 * Prompt template system tests.
 *
 * Run: node --import tsx src/prompts/prompts.test.ts
 *
 * Tests cover:
 *   1. Context building — from domain objects
 *   2. Template parsing — variable extraction and validation
 *   3. Rendering — successful substitution, missing vars, unused vars
 *   4. Loader — disk-based template loading and caching
 */

import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildPromptContext,
  isUnset,
  type PromptContext,
  type PromptContextInput,
} from "./context.js";
import {
  parseTemplate,
  extractVariables,
  isValidVariable,
  getValidVariables,
  TemplateParseError,
} from "./template.js";
import {
  renderPrompt,
  PromptRenderError,
  UnusedVariableError,
} from "./renderer.js";
import { PromptTemplateLoader, TemplateLoadError } from "./loader.js";
import {
  parseConditionalBlocks,
  evaluateCondition,
  resolveConditionals,
  getEnumValues,
  ConditionalParseError,
  type ConditionalBlock,
} from "./conditional.js";
import {
  buildPromptConstraints,
  formatConstraints,
  countConstraints,
  type PromptConstraints,
} from "./constraints.js";
import type { Topic } from "../topics/schema.js";
import type { ResearchSpecification } from "../specification/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";
import type { SeoGuidelines } from "../standards/seo-schema.js";

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
      git: { commitSha: "abc123", branch: "main", isDirty: false },
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
      dietaryAlignment: ["vegan"],
      emphasize: ["plant-based ingredients", "Ayurvedic tradition"],
      deemphasize: ["synthetic alternatives"],
    },
  } as unknown as ContentStandards;
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
      sentenceWords: { min: 5, max: 30 },
    },
    metaContent: {
      titleLength: { min: 40, max: 60 },
      descriptionLength: { min: 140, max: 160 },
      requireCanonicalUrl: true,
    },
    readability: {
      fleschReadingEase: { min: 55, max: 75 },
      maxPassiveVoicePercent: 15,
    },
  } as unknown as SeoGuidelines;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONTEXT BUILDING TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Context Building");

test("buildPromptContext populates topic fields", () => {
  const topic = makeTopic();
  const ctx = buildPromptContext({ topic });

  assert.equal(ctx["topic.id"], "turmeric_helps_redness");
  assert.equal(ctx["topic.entity"], "turmeric");
  assert.equal(ctx["topic.entityType"], "herb");
  assert.equal(ctx["topic.name"], "Turmeric Reduces Skin Redness");
  assert.equal(ctx["topic.condition"], "redness_hyperpigmentation");
  assert.equal(ctx["topic.category"], "ayurvedic_herbs_in_skincare_that_help_skin");
  assert.equal(ctx["topic.priority"], "high");
  assert.equal(ctx["topic.status"], "active");
});

test("buildPromptContext populates claim fields", () => {
  const topic = makeTopic();
  const ctx = buildPromptContext({ topic });

  assert.equal(ctx["topic.claim.direction"], "helps");
  assert.equal(ctx["topic.claim.mechanism"], "curcumin inhibits inflammatory cytokines (TNF-α, IL-6)");
  assert.equal(ctx["topic.claim.confidence"], "established");
});

test("buildPromptContext marks spec fields UNSET when no specification", () => {
  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.ok(isUnset(ctx["research.runId"]));
  assert.ok(isUnset(ctx["research.version"]));
  assert.ok(isUnset(ctx["research.totalTopics"]));
  assert.ok(isUnset(ctx["research.minCitationsPerClaim"]));
  assert.ok(isUnset(ctx["research.preferredDatabases"]));
});

test("buildPromptContext populates spec fields when provided", () => {
  const ctx = buildPromptContext({
    topic: makeTopic(),
    specification: makeSpecification(),
  });

  assert.equal(ctx["research.runId"], "run-20250101-abc123");
  assert.equal(ctx["research.version"], "2.0.0");
  assert.equal(ctx["research.totalTopics"], "1");
  assert.equal(ctx["research.activeTopics"], "1");
  assert.equal(ctx["research.minCitationsPerClaim"], "2");
  assert.equal(ctx["research.minSourcesPerTopic"], "3");
  assert.equal(ctx["research.maxSourceAgeYears"], "10");
  assert.ok(ctx["research.allowedEvidenceTypes"].includes("systematic_review"));
  assert.ok(ctx["research.preferredDatabases"].includes("PubMed"));
});

test("buildPromptContext marks content standards UNSET when not provided", () => {
  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.ok(isUnset(ctx["contentStandards.name"]));
  assert.ok(isUnset(ctx["contentStandards.tone"]));
  assert.ok(isUnset(ctx["contentStandards.citationFormat"]));
  assert.ok(isUnset(ctx["contentStandards.forbiddenPhrases"]));
});

test("buildPromptContext populates content standards when provided", () => {
  const ctx = buildPromptContext({
    topic: makeTopic(),
    contentStandards: makeContentStandards(),
  });

  assert.equal(ctx["contentStandards.name"], "Test Standards");
  assert.ok(ctx["contentStandards.tone"].includes("educational"));
  assert.equal(ctx["contentStandards.perspective"], "second_person");
  assert.equal(ctx["contentStandards.readingLevelMin"], "8");
  assert.equal(ctx["contentStandards.readingLevelMax"], "12");
  assert.equal(ctx["contentStandards.citationFormat"], "numeric");
  assert.equal(ctx["contentStandards.minReferences"], "5");
  assert.ok(ctx["contentStandards.forbiddenPhrases"].includes("miracle cure"));
  assert.ok(ctx["contentStandards.requiredDisclaimers"].includes("Consult"));
  assert.ok(ctx["contentStandards.brandValues"].includes("vegan"));
});

test("buildPromptContext marks SEO UNSET when not provided", () => {
  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.ok(isUnset(ctx["seo.name"]));
  assert.ok(isUnset(ctx["seo.wordCountMin"]));
  assert.ok(isUnset(ctx["seo.keywordDensityMax"]));
});

test("buildPromptContext populates SEO when provided", () => {
  const ctx = buildPromptContext({
    topic: makeTopic(),
    seoGuidelines: makeSeoGuidelines(),
  });

  assert.equal(ctx["seo.name"], "Test SEO");
  assert.equal(ctx["seo.wordCountMin"], "1200");
  assert.equal(ctx["seo.wordCountMax"], "2500");
  assert.equal(ctx["seo.keywordDensityMin"], "1");
  assert.equal(ctx["seo.keywordDensityMax"], "2.5");
  assert.equal(ctx["seo.minH2Count"], "3");
  assert.equal(ctx["seo.maxHeadingWords"], "12");
  assert.equal(ctx["seo.metaTitleLengthMin"], "40");
  assert.equal(ctx["seo.metaTitleLengthMax"], "60");
  assert.equal(ctx["seo.fleschReadingEaseMin"], "55");
  assert.equal(ctx["seo.fleschReadingEaseMax"], "75");
  assert.equal(ctx["seo.maxPassiveVoicePercent"], "15");
});

test("buildPromptContext returns a frozen object", () => {
  const ctx = buildPromptContext({ topic: makeTopic() });
  assert.ok(Object.isFrozen(ctx));
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TEMPLATE PARSING TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Template Parsing");

test("extractVariables finds all placeholders", () => {
  const source = "Hello {{topic.entity}}, your condition is {{topic.condition}}.";
  const vars = extractVariables(source);
  assert.deepEqual(vars, ["topic.condition", "topic.entity"]);
});

test("extractVariables handles whitespace inside braces", () => {
  const source = "{{ topic.entity }} and {{  topic.condition  }}";
  const vars = extractVariables(source);
  assert.deepEqual(vars, ["topic.condition", "topic.entity"]);
});

test("extractVariables deduplicates", () => {
  const source = "{{topic.entity}} loves {{topic.entity}}";
  const vars = extractVariables(source);
  assert.deepEqual(vars, ["topic.entity"]);
});

test("extractVariables returns empty for no placeholders", () => {
  const vars = extractVariables("No variables here.");
  assert.deepEqual(vars, []);
});

test("isValidVariable returns true for known variables", () => {
  assert.ok(isValidVariable("topic.entity"));
  assert.ok(isValidVariable("research.runId"));
  assert.ok(isValidVariable("seo.wordCountMin"));
  assert.ok(isValidVariable("contentStandards.tone"));
});

test("isValidVariable returns false for unknown variables", () => {
  assert.ok(!isValidVariable("topic.unknown"));
  assert.ok(!isValidVariable("foo.bar"));
  assert.ok(!isValidVariable("invalid"));
});

test("getValidVariables returns sorted list", () => {
  const vars = getValidVariables();
  assert.ok(vars.length > 30, "Should have many valid variables");
  const sorted = [...vars].sort();
  assert.deepEqual(vars, sorted);
});

test("parseTemplate succeeds with valid variables", () => {
  const source = "Entity: {{topic.entity}}, Condition: {{topic.condition}}";
  const parsed = parseTemplate(source, "test-template");

  assert.equal(parsed.name, "test-template");
  assert.equal(parsed.source, source);
  assert.deepEqual(parsed.variables, ["topic.condition", "topic.entity"]);
});

test("parseTemplate throws on invalid variable names", () => {
  const source = "{{topic.entity}} and {{invalid.variable}}";
  assert.throws(
    () => parseTemplate(source, "bad-template"),
    (err: unknown) => {
      assert.ok(err instanceof TemplateParseError);
      assert.equal(err.templateName, "bad-template");
      assert.deepEqual(err.invalidVariables, ["invalid.variable"]);
      return true;
    }
  );
});

test("parseTemplate throws listing all invalid variables", () => {
  const source = "{{bad.one}} and {{bad.two}} and {{topic.entity}}";
  assert.throws(
    () => parseTemplate(source, "multi-bad"),
    (err: unknown) => {
      assert.ok(err instanceof TemplateParseError);
      assert.deepEqual(err.invalidVariables, ["bad.one", "bad.two"]);
      return true;
    }
  );
});

test("parseTemplate succeeds with no variables", () => {
  const parsed = parseTemplate("Just plain text.", "plain");
  assert.deepEqual(parsed.variables, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RENDERING TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Rendering");

test("renderPrompt replaces all placeholders", () => {
  const source = "Study {{topic.entity}} for {{topic.condition}}.";
  const template = parseTemplate(source, "render-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.equal(result, "Study turmeric for redness_hyperpigmentation.");
});

test("renderPrompt handles duplicate placeholders", () => {
  const source = "{{topic.entity}} is great. Yes, {{topic.entity}}!";
  const template = parseTemplate(source, "dup-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.equal(result, "turmeric is great. Yes, turmeric!");
});

test("renderPrompt succeeds in strict mode when all context vars are used", () => {
  // Use every single variable in the context
  const allVars = getValidVariables();
  const source = allVars.map((v) => `{{${v}}}`).join(" ");
  const template = parseTemplate(source, "strict-all");

  const ctx = buildPromptContext({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  // Should not throw
  const result = renderPrompt(template, ctx, { strict: true });
  assert.ok(result.length > 0);
  assert.ok(!result.includes("{{"), "No unresolved placeholders");
});

test("renderPrompt throws PromptRenderError for missing variables", () => {
  const source = "Entity: {{topic.entity}}, Run: {{research.runId}}";
  const template = parseTemplate(source, "missing-test");

  // Only provide topic (no specification), so research.runId is UNSET
  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.throws(
    () => renderPrompt(template, ctx, { strict: false }),
    (err: unknown) => {
      assert.ok(err instanceof PromptRenderError);
      assert.equal(err.templateName, "missing-test");
      assert.ok(err.missingVariables.includes("research.runId"));
      return true;
    }
  );
});

test("renderPrompt throws PromptRenderError listing all missing vars", () => {
  const source = "{{research.runId}} {{seo.wordCountMin}} {{topic.entity}}";
  const template = parseTemplate(source, "multi-missing");

  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.throws(
    () => renderPrompt(template, ctx),
    (err: unknown) => {
      assert.ok(err instanceof PromptRenderError);
      assert.ok(err.missingVariables.includes("research.runId"));
      assert.ok(err.missingVariables.includes("seo.wordCountMin"));
      assert.ok(!err.missingVariables.includes("topic.entity"));
      return true;
    }
  );
});

test("renderPrompt throws UnusedVariableError in strict mode", () => {
  // Template only uses topic.entity, but context has all topic vars
  const source = "Just {{topic.entity}}.";
  const template = parseTemplate(source, "unused-test");

  const ctx = buildPromptContext({ topic: makeTopic() });

  assert.throws(
    () => renderPrompt(template, ctx, { strict: true }),
    (err: unknown) => {
      assert.ok(err instanceof UnusedVariableError);
      assert.equal(err.templateName, "unused-test");
      assert.ok(err.unusedVariables.length > 0);
      assert.ok(err.unusedVariables.includes("topic.condition"));
      return true;
    }
  );
});

test("renderPrompt allows unused variables in non-strict mode", () => {
  const source = "Just {{topic.entity}}.";
  const template = parseTemplate(source, "lenient-test");

  const ctx = buildPromptContext({ topic: makeTopic() });

  // Should NOT throw
  const result = renderPrompt(template, ctx, { strict: false });
  assert.equal(result, "Just turmeric.");
});

test("renderPrompt with full context and partial template (non-strict)", () => {
  const source =
    "# {{topic.name}}\n\n" +
    "{{topic.entity}} ({{topic.entityType}}) {{topic.claim.direction}} {{topic.condition}}.\n\n" +
    "Mechanism: {{topic.claim.mechanism}}";
  const template = parseTemplate(source, "partial-test");

  const ctx = buildPromptContext({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  const result = renderPrompt(template, ctx, { strict: false });
  assert.ok(result.startsWith("# Turmeric Reduces Skin Redness"));
  assert.ok(result.includes("turmeric (herb) helps redness_hyperpigmentation"));
  assert.ok(result.includes("curcumin inhibits"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LOADER TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Loader");

// Create a temp directory for loader tests
const LOADER_DIR = join(tmpdir(), `prompt-test-${Date.now()}`);

function setupLoaderDir(): void {
  mkdirSync(LOADER_DIR, { recursive: true });

  writeFileSync(
    join(LOADER_DIR, "simple.md"),
    "Hello {{topic.entity}}, condition: {{topic.condition}}."
  );

  writeFileSync(
    join(LOADER_DIR, "plain.txt"),
    "Entity is {{topic.entity}}."
  );

  writeFileSync(
    join(LOADER_DIR, "no-vars.md"),
    "This template has no variables."
  );

  writeFileSync(
    join(LOADER_DIR, "not-a-template.json"),
    '{"key": "value"}'
  );
}

function cleanupLoaderDir(): void {
  try {
    rmSync(LOADER_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

setupLoaderDir();

test("PromptTemplateLoader.load() loads and parses a .md template", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const tmpl = loader.load("simple.md");

  assert.equal(tmpl.name, "simple");
  assert.deepEqual(tmpl.variables, ["topic.condition", "topic.entity"]);
  assert.ok(tmpl.source.includes("{{topic.entity}}"));
});

test("PromptTemplateLoader.load() loads .txt templates", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const tmpl = loader.load("plain.txt");

  assert.equal(tmpl.name, "plain");
  assert.deepEqual(tmpl.variables, ["topic.entity"]);
});

test("PromptTemplateLoader.load() caches results", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const first = loader.load("simple.md");
  const second = loader.load("simple.md");
  assert.equal(first, second, "Should return same cached object");
});

test("PromptTemplateLoader.load() throws for missing files", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  assert.throws(
    () => loader.load("nonexistent.md"),
    (err: unknown) => {
      assert.ok(err instanceof TemplateLoadError);
      return true;
    }
  );
});

test("PromptTemplateLoader.load() throws for unsupported extensions", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  assert.throws(
    () => loader.load("not-a-template.json"),
    (err: unknown) => {
      assert.ok(err instanceof TemplateLoadError);
      assert.ok(err.message.includes("Unsupported"));
      return true;
    }
  );
});

test("PromptTemplateLoader.loadAll() loads all template files", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const all = loader.loadAll();

  // simple.md, plain.txt, no-vars.md — but NOT not-a-template.json
  assert.equal(all.size, 3);
  assert.ok(all.has("simple.md"));
  assert.ok(all.has("plain.txt"));
  assert.ok(all.has("no-vars.md"));
  assert.ok(!all.has("not-a-template.json"));
});

test("PromptTemplateLoader.clearCache() enables re-loading", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const first = loader.load("simple.md");
  loader.clearCache();
  const second = loader.load("simple.md");
  // After clearing cache, should reload (different object identity)
  assert.notEqual(first, second, "After clearCache, should return new object");
  // But content should be the same
  assert.deepEqual(first.variables, second.variables);
});

test("PromptTemplateLoader constructor throws for missing directory", () => {
  assert.throws(
    () => new PromptTemplateLoader("/nonexistent/path/to/templates"),
    (err: unknown) => {
      assert.ok(err instanceof TemplateLoadError);
      return true;
    }
  );
});

test("PromptTemplateLoader.listTemplates() lists template files", () => {
  const files = PromptTemplateLoader.listTemplates(LOADER_DIR);
  assert.ok(files.includes("simple.md"));
  assert.ok(files.includes("plain.txt"));
  assert.ok(files.includes("no-vars.md"));
  assert.ok(!files.includes("not-a-template.json"));
});

test("PromptTemplateLoader.listTemplates() returns empty for missing dir", () => {
  const files = PromptTemplateLoader.listTemplates("/nonexistent");
  assert.deepEqual(files, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. END-TO-END: Load → Parse → Build Context → Render
// ═══════════════════════════════════════════════════════════════════════════

section("End-to-End");

test("full pipeline: load template, build context, render", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const template = loader.load("simple.md");
  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.equal(result, "Hello turmeric, condition: redness_hyperpigmentation.");
});

test("batch rendering: same template, different topics", () => {
  const loader = new PromptTemplateLoader(LOADER_DIR);
  const template = loader.load("simple.md");

  const topics: Topic[] = [
    makeTopic({ id: "turmeric_helps_redness", primaryEntity: "turmeric", condition: "redness_hyperpigmentation" }),
    makeTopic({
      id: "dairy_harms_acne",
      primaryEntity: "dairy",
      entityType: "food",
      condition: "acne_acne_scars",
      category: "animal_ingredients_in_food_that_harm_skin",
      claim: { direction: "harms", mechanism: "hormones stimulate sebum production", confidence: "emerging" },
      name: "Dairy Worsens Acne",
    }),
  ];

  const results: string[] = [];
  for (const topic of topics) {
    const ctx = buildPromptContext({ topic });
    results.push(renderPrompt(template, ctx, { strict: false }));
  }

  assert.equal(results[0], "Hello turmeric, condition: redness_hyperpigmentation.");
  assert.equal(results[1], "Hello dairy, condition: acne_acne_scars.");
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LOADER INTEGRATION WITH REAL prompts/ DIRECTORY
// ═══════════════════════════════════════════════════════════════════════════

section("Real Template Integration");

test("load deep-research.md from prompts/ directory", () => {
  const loader = new PromptTemplateLoader("prompts/");
  const tmpl = loader.load("deep-research.md");

  assert.equal(tmpl.name, "deep-research");
  assert.ok(tmpl.variables.length > 10, "Should reference many variables");
  assert.ok(tmpl.variables.includes("topic.entity" as any));
  assert.ok(tmpl.variables.includes("research.runId" as any));
  assert.ok(tmpl.variables.includes("seo.wordCountMin" as any));
});

test("render deep-research.md with full context", () => {
  const loader = new PromptTemplateLoader("prompts/");
  const tmpl = loader.load("deep-research.md");

  const ctx = buildPromptContext({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  const result = renderPrompt(tmpl, ctx, { strict: false });

  assert.ok(result.includes("turmeric"), "Should contain entity");
  assert.ok(result.includes("redness_hyperpigmentation"), "Should contain condition");
  assert.ok(result.includes("run-20250101-abc123"), "Should contain run ID");
  assert.ok(result.includes("1200"), "Should contain SEO word count min");
  assert.ok(!result.includes("{{"), "No unresolved placeholders");
  assert.ok(!result.includes("__UNSET__"), "No UNSET sentinels");
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CONDITIONAL BLOCK PARSING
// ═══════════════════════════════════════════════════════════════════════════

section("Conditional Parsing");

test("parseConditionalBlocks extracts equality conditional", () => {
  const source = '{{#if topic.claim.direction == "harms"}}Harmful content.{{/if}}';
  const blocks = parseConditionalBlocks(source, "eq-test", isValidVariable);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].variable, "topic.claim.direction");
  assert.equal(blocks[0].operator, "==");
  assert.equal(blocks[0].value, "harms");
  assert.equal(blocks[0].body, "Harmful content.");
});

test("parseConditionalBlocks extracts inequality conditional", () => {
  const source = '{{#if topic.category != "habits_that_harm_skin"}}Not a habit.{{/if}}';
  const blocks = parseConditionalBlocks(source, "neq-test", isValidVariable);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].operator, "!=");
  assert.equal(blocks[0].value, "habits_that_harm_skin");
});

test("parseConditionalBlocks extracts truthy conditional", () => {
  const source = "{{#if topic.claim.mechanism}}Has mechanism.{{/if}}";
  const blocks = parseConditionalBlocks(source, "truthy-test", isValidVariable);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].operator, "truthy");
  assert.equal(blocks[0].value, undefined);
});

test("parseConditionalBlocks extracts multiple blocks", () => {
  const source =
    '{{#if topic.claim.direction == "helps"}}Good.{{/if}} ' +
    '{{#if topic.condition == "acne_acne_scars"}}Acne.{{/if}}';
  const blocks = parseConditionalBlocks(source, "multi-test", isValidVariable);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].variable, "topic.claim.direction");
  assert.equal(blocks[1].variable, "topic.condition");
});

test("parseConditionalBlocks preserves body with placeholders", () => {
  const source =
    '{{#if topic.condition == "acne_acne_scars"}}' +
    "Acne info for {{topic.entity}}." +
    "{{/if}}";
  const blocks = parseConditionalBlocks(source, "body-test", isValidVariable);

  assert.equal(blocks.length, 1);
  assert.ok(blocks[0].body.includes("{{topic.entity}}"));
});

test("parseConditionalBlocks throws for invalid variable name", () => {
  const source = '{{#if invalid.field == "value"}}Content.{{/if}}';
  assert.throws(
    () => parseConditionalBlocks(source, "bad-var", isValidVariable),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      assert.equal(err.templateName, "bad-var");
      assert.ok(err.issues.some((i: string) => i.includes("invalid.field")));
      return true;
    }
  );
});

test("parseConditionalBlocks throws for invalid enum value", () => {
  const source = '{{#if topic.condition == "not_a_real_condition"}}Content.{{/if}}';
  assert.throws(
    () => parseConditionalBlocks(source, "bad-enum", isValidVariable),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      assert.ok(err.issues.some((i: string) => i.includes("not_a_real_condition")));
      assert.ok(err.issues.some((i: string) => i.includes("allowed:")));
      return true;
    }
  );
});

test("parseConditionalBlocks throws for invalid category enum", () => {
  const source = '{{#if topic.category == "animal_foods_harm_skin"}}Content.{{/if}}';
  assert.throws(
    () => parseConditionalBlocks(source, "bad-cat", isValidVariable),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      assert.ok(err.issues.some((i: string) => i.includes("animal_foods_harm_skin")));
      return true;
    }
  );
});

test("parseConditionalBlocks allows non-enum variables with any value", () => {
  const source = '{{#if topic.entity == "turmeric"}}Turmeric content.{{/if}}';
  const blocks = parseConditionalBlocks(source, "free-val", isValidVariable);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].value, "turmeric");
});

test("parseConditionalBlocks rejects nested conditionals", () => {
  const source =
    '{{#if topic.claim.direction == "harms"}}' +
    '{{#if topic.condition == "acne_acne_scars"}}Nested.{{/if}}' +
    "{{/if}}";
  assert.throws(
    () => parseConditionalBlocks(source, "nested", isValidVariable),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      assert.ok(err.issues.some((i: string) => i.includes("Nested")));
      return true;
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONDITIONAL EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

section("Conditional Evaluation");

test("evaluateCondition: truthy returns true for non-empty string", () => {
  const block: ConditionalBlock = {
    variable: "topic.entity" as any,
    operator: "truthy",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "turmeric"), true);
});

test("evaluateCondition: truthy returns false for empty string", () => {
  const block: ConditionalBlock = {
    variable: "topic.entity" as any,
    operator: "truthy",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, ""), false);
});

test("evaluateCondition: truthy returns false for UNSET", () => {
  const block: ConditionalBlock = {
    variable: "topic.entity" as any,
    operator: "truthy",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "__UNSET__"), false);
});

test("evaluateCondition: == returns true on match", () => {
  const block: ConditionalBlock = {
    variable: "topic.claim.direction" as any,
    operator: "==",
    value: "harms",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "harms"), true);
});

test("evaluateCondition: == returns false on mismatch", () => {
  const block: ConditionalBlock = {
    variable: "topic.claim.direction" as any,
    operator: "==",
    value: "harms",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "helps"), false);
});

test("evaluateCondition: == returns false for UNSET", () => {
  const block: ConditionalBlock = {
    variable: "research.runId" as any,
    operator: "==",
    value: "some-id",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "__UNSET__"), false);
});

test("evaluateCondition: != returns true on mismatch", () => {
  const block: ConditionalBlock = {
    variable: "topic.claim.direction" as any,
    operator: "!=",
    value: "harms",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "helps"), true);
});

test("evaluateCondition: != returns false on match", () => {
  const block: ConditionalBlock = {
    variable: "topic.claim.direction" as any,
    operator: "!=",
    value: "harms",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "harms"), false);
});

test("evaluateCondition: != returns true for UNSET", () => {
  const block: ConditionalBlock = {
    variable: "research.runId" as any,
    operator: "!=",
    value: "some-id",
    body: "content",
    raw: "",
  };
  assert.equal(evaluateCondition(block, "__UNSET__"), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. CONDITIONAL RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════

section("Conditional Resolution");

test("resolveConditionals includes block when condition is true", () => {
  const source = 'Before.{{#if topic.claim.direction == "helps"}}INCLUDED.{{/if}}After.';
  const ctx = { "topic.claim.direction": "helps" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "Before.INCLUDED.After.");
});

test("resolveConditionals excludes block when condition is false", () => {
  const source = 'Before.{{#if topic.claim.direction == "harms"}}EXCLUDED.{{/if}}After.';
  const ctx = { "topic.claim.direction": "helps" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "Before.After.");
});

test("resolveConditionals handles truthy check", () => {
  const source = "{{#if topic.claim.mechanism}}Has mechanism.{{/if}}";
  const ctx = { "topic.claim.mechanism": "reduces inflammation" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "Has mechanism.");
});

test("resolveConditionals excludes truthy block for empty value", () => {
  const source = "{{#if topic.claim.mechanism}}Has mechanism.{{/if}}";
  const ctx = { "topic.claim.mechanism": "" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "");
});

test("resolveConditionals handles != operator", () => {
  const source =
    '{{#if topic.category != "habits_that_harm_skin"}}Not habits.{{/if}}';
  const ctx = { "topic.category": "vegan_foods_that_help_skin" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "Not habits.");
});

test("resolveConditionals handles multiple blocks independently", () => {
  const source =
    '{{#if topic.claim.direction == "helps"}}HELPS.{{/if}}' +
    '{{#if topic.claim.direction == "harms"}}HARMS.{{/if}}';
  const ctx = { "topic.claim.direction": "helps" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "HELPS.");
});

test("resolveConditionals preserves placeholders in body", () => {
  const source =
    '{{#if topic.claim.direction == "helps"}}' +
    "Entity: {{topic.entity}}" +
    "{{/if}}";
  const ctx = { "topic.claim.direction": "helps" } as any;

  const result = resolveConditionals(source, ctx);
  assert.equal(result, "Entity: {{topic.entity}}");
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. FULL RENDER WITH CONDITIONALS
// ═══════════════════════════════════════════════════════════════════════════

section("Render with Conditionals");

test("renderPrompt includes matching conditional block", () => {
  const source =
    "Topic: {{topic.entity}}.\n" +
    '{{#if topic.claim.direction == "helps"}}This entity helps skin.{{/if}}';
  const template = parseTemplate(source, "cond-include");

  const ctx = buildPromptContext({ topic: makeTopic() }); // direction = "helps"
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(result.includes("Topic: turmeric."));
  assert.ok(result.includes("This entity helps skin."));
});

test("renderPrompt excludes non-matching conditional block", () => {
  const source =
    "Topic: {{topic.entity}}.\n" +
    '{{#if topic.claim.direction == "harms"}}This entity harms skin.{{/if}}';
  const template = parseTemplate(source, "cond-exclude");

  const ctx = buildPromptContext({ topic: makeTopic() }); // direction = "helps"
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(result.includes("Topic: turmeric."));
  assert.ok(!result.includes("This entity harms skin."));
});

test("renderPrompt renders variables inside included conditional", () => {
  const source =
    '{{#if topic.claim.direction == "helps"}}' +
    "{{topic.entity}} helps {{topic.condition}}." +
    "{{/if}}";
  const template = parseTemplate(source, "cond-vars");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.equal(result, "turmeric helps redness_hyperpigmentation.");
});

test("renderPrompt does not require variables inside excluded conditional", () => {
  // Template has research.runId inside a conditional that won't match,
  // and we don't provide a specification. Should not throw.
  const source =
    "Topic: {{topic.entity}}.\n" +
    '{{#if topic.claim.direction == "harms"}}Run: {{research.runId}}{{/if}}';
  const template = parseTemplate(source, "cond-no-require");

  const ctx = buildPromptContext({ topic: makeTopic() }); // no specification
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(result.includes("Topic: turmeric."));
  assert.ok(!result.includes("research.runId"));
  assert.ok(!result.includes("__UNSET__"));
});

test("renderPrompt with category-specific conditional", () => {
  const source =
    "# {{topic.name}}\n\n" +
    '{{#if topic.category == "ayurvedic_herbs_in_skincare_that_help_skin"}}' +
    "Reference Ayurvedic texts for {{topic.entity}}.\n" +
    "{{/if}}" +
    '{{#if topic.category == "animal_ingredients_in_food_that_harm_skin"}}' +
    "Investigate hormonal pathways.\n" +
    "{{/if}}";
  const template = parseTemplate(source, "cat-cond");

  // Topic is in ayurvedic herbs category
  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(result.includes("Reference Ayurvedic texts for turmeric."));
  assert.ok(!result.includes("Investigate hormonal pathways."));
});

test("renderPrompt with condition-specific conditional", () => {
  const source =
    '{{#if topic.condition == "acne_acne_scars"}}Acne section.{{/if}}' +
    '{{#if topic.condition == "redness_hyperpigmentation"}}Redness section.{{/if}}';
  const template = parseTemplate(source, "condition-cond");

  const ctx = buildPromptContext({ topic: makeTopic() }); // condition = redness
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(!result.includes("Acne section."));
  assert.ok(result.includes("Redness section."));
});

test("renderPrompt with confidence-level conditional", () => {
  const source =
    '{{#if topic.claim.confidence == "preliminary"}}' +
    "Low confidence warning.\n" +
    "{{/if}}" +
    "Report for {{topic.entity}}.";
  const template = parseTemplate(source, "confidence-cond");

  // Default topic has confidence "established"
  const ctx1 = buildPromptContext({ topic: makeTopic() });
  const result1 = renderPrompt(template, ctx1, { strict: false });
  assert.ok(!result1.includes("Low confidence warning."));
  assert.ok(result1.includes("Report for turmeric."));

  // Topic with preliminary confidence
  const ctx2 = buildPromptContext({
    topic: makeTopic({
      id: "kale_helps_redness",
      primaryEntity: "kale",
      entityType: "food",
      category: "vegan_foods_that_help_skin",
      claim: { direction: "helps", mechanism: "provides antioxidant vitamin C", confidence: "preliminary" },
      name: "Kale Reduces Redness",
    }),
  });
  const result2 = renderPrompt(template, ctx2, { strict: false });
  assert.ok(result2.includes("Low confidence warning."));
  assert.ok(result2.includes("Report for kale."));
});

test("renderPrompt: same template renders differently for helps vs harms topics", () => {
  const source =
    "# {{topic.entity}}\n" +
    '{{#if topic.claim.direction == "helps"}}BENEFIT: {{topic.entity}} supports skin.{{/if}}' +
    '{{#if topic.claim.direction == "harms"}}WARNING: {{topic.entity}} damages skin.{{/if}}';
  const template = parseTemplate(source, "dual-direction");

  // Helps topic
  const helpsCtx = buildPromptContext({ topic: makeTopic() });
  const helpsResult = renderPrompt(template, helpsCtx, { strict: false });
  assert.ok(helpsResult.includes("BENEFIT: turmeric supports skin."));
  assert.ok(!helpsResult.includes("WARNING:"));

  // Harms topic
  const harmsTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });
  const harmsCtx = buildPromptContext({ topic: harmsTopic });
  const harmsResult = renderPrompt(template, harmsCtx, { strict: false });
  assert.ok(!harmsResult.includes("BENEFIT:"));
  assert.ok(harmsResult.includes("WARNING: dairy damages skin."));
});

test("parseTemplate throws ConditionalParseError for invalid conditional var", () => {
  const source = '{{#if nonexistent.var == "value"}}Content.{{/if}}';
  assert.throws(
    () => parseTemplate(source, "bad-cond-var"),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      return true;
    }
  );
});

test("parseTemplate throws ConditionalParseError for invalid enum value", () => {
  const source = '{{#if topic.condition == "fake_condition"}}Content.{{/if}}';
  assert.throws(
    () => parseTemplate(source, "bad-cond-enum"),
    (err: unknown) => {
      assert.ok(err instanceof ConditionalParseError);
      return true;
    }
  );
});

test("conditionals count as used in strict mode", () => {
  // Build a template that uses ALL variables: all as {{var}} placeholders,
  // plus one via a conditional. The conditional variable should count as used.
  const allVars = getValidVariables();
  const source =
    allVars.map((v) => `{{${v}}}`).join(" ") +
    '\n{{#if topic.claim.direction == "helps"}}Conditional section.{{/if}}';
  const template = parseTemplate(source, "strict-cond");

  const ctx = buildPromptContext({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  // Should not throw — topic.claim.direction is used both as {{var}} and conditional
  const result = renderPrompt(template, ctx, { strict: true });
  assert.ok(result.includes("Conditional section."));
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. ENUM VALUES INTROSPECTION
// ═══════════════════════════════════════════════════════════════════════════

section("Enum Values");

test("getEnumValues returns set for topic.condition", () => {
  const vals = getEnumValues("topic.condition");
  assert.ok(vals);
  assert.ok(vals.has("acne_acne_scars"));
  assert.ok(vals.has("redness_hyperpigmentation"));
  assert.ok(vals.has("dryness_premature_aging"));
  assert.ok(vals.has("oily_skin"));
  assert.equal(vals.size, 4);
});

test("getEnumValues returns set for topic.category", () => {
  const vals = getEnumValues("topic.category");
  assert.ok(vals);
  assert.equal(vals.size, 10);
  assert.ok(vals.has("vegan_foods_that_help_skin"));
  assert.ok(vals.has("habits_that_harm_skin"));
});

test("getEnumValues returns set for topic.claim.direction", () => {
  const vals = getEnumValues("topic.claim.direction");
  assert.ok(vals);
  assert.equal(vals.size, 2);
  assert.ok(vals.has("helps"));
  assert.ok(vals.has("harms"));
});

test("getEnumValues returns undefined for free-text variables", () => {
  assert.equal(getEnumValues("topic.entity"), undefined);
  assert.equal(getEnumValues("topic.name"), undefined);
  assert.equal(getEnumValues("research.runId"), undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. REAL TEMPLATE INTEGRATION WITH CONDITIONALS
// ═══════════════════════════════════════════════════════════════════════════

section("Real Template with Conditionals");

test("deep-research.md parses with conditionals", () => {
  const loader = new PromptTemplateLoader("prompts/");
  const tmpl = loader.load("deep-research.md");

  assert.ok(tmpl.conditionals.length > 0, "Should have conditional blocks");

  // Should have direction conditionals
  const directionConds = tmpl.conditionals.filter(
    (c) => c.variable === "topic.claim.direction"
  );
  assert.ok(directionConds.length >= 2, "Should have helps + harms conditionals");

  // Should have category conditionals
  const categoryConds = tmpl.conditionals.filter(
    (c) => c.variable === "topic.category"
  );
  assert.ok(categoryConds.length >= 5, "Should have category-specific conditionals");

  // Should have condition conditionals
  const conditionConds = tmpl.conditionals.filter(
    (c) => c.variable === "topic.condition"
  );
  assert.ok(conditionConds.length >= 4, "Should have skin-condition conditionals");
});

test("deep-research.md renders ayurvedic herb topic correctly", () => {
  const loader = new PromptTemplateLoader("prompts/");
  loader.clearCache();
  const tmpl = loader.load("deep-research.md");

  const ctx = buildPromptContext({
    topic: makeTopic(), // turmeric, helps, redness, ayurvedic herbs
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  const result = renderPrompt(tmpl, ctx, { strict: false });

  // Should include helps-specific section
  assert.ok(result.includes("Benefit-Specific Research Requirements"));
  // Should include ayurvedic herb section
  assert.ok(result.includes("Ayurvedic Topical Herb Research"));
  // Should include redness section
  assert.ok(result.includes("Redness & Hyperpigmentation Considerations"));
  // Should NOT include harms section
  assert.ok(!result.includes("Harm-Specific Research Requirements"));
  // Should NOT include acne section
  assert.ok(!result.includes("Acne-Specific Considerations"));
  // Should NOT include animal ingredient section
  assert.ok(!result.includes("Animal-Ingredient Dietary Research"));
  // Should NOT include preliminary warning (confidence is established)
  assert.ok(!result.includes("Low-Confidence Evidence Note"));
  // No unresolved placeholders or sentinels
  assert.ok(!result.includes("{{"), "No unresolved placeholders");
  assert.ok(!result.includes("__UNSET__"), "No UNSET sentinels");
});

test("deep-research.md renders dairy/harms/acne topic correctly", () => {
  const loader = new PromptTemplateLoader("prompts/");
  loader.clearCache();
  const tmpl = loader.load("deep-research.md");

  const dairyTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "contains hormones that stimulate sebum production", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const ctx = buildPromptContext({
    topic: dairyTopic,
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
    seoGuidelines: makeSeoGuidelines(),
  });

  const result = renderPrompt(tmpl, ctx, { strict: false });

  // Should include harms-specific section
  assert.ok(result.includes("Harm-Specific Research Requirements"));
  // Should include animal ingredient dietary section
  assert.ok(result.includes("Animal-Ingredient Dietary Research"));
  assert.ok(result.includes("IGF-1, mTORC1"));
  // Should include acne section
  assert.ok(result.includes("Acne-Specific Considerations"));
  // Should NOT include helps section
  assert.ok(!result.includes("Benefit-Specific Research Requirements"));
  // Should NOT include redness section
  assert.ok(!result.includes("Redness & Hyperpigmentation Considerations"));
  // No unresolved
  assert.ok(!result.includes("{{"));
  assert.ok(!result.includes("__UNSET__"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. CONSTRAINT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

section("Constraint Generation");

test("buildPromptConstraints with topic only produces directional rules", () => {
  const constraints = buildPromptConstraints({ topic: makeTopic() });

  // No specification or content standards → no universal rules
  assert.equal(constraints.universal.length, 0);
  // Should still have directional rules from claim direction
  assert.ok(constraints.directional.length > 0);
});

test("buildPromptConstraints with specification produces evidence rules", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
  });

  const evidenceRules = constraints.universal.filter((r) => r.category === "evidence");
  assert.ok(evidenceRules.length >= 3, "Should have multiple evidence rules");

  const texts = evidenceRules.map((r) => r.text);
  assert.ok(texts.some((t) => t.includes("2 citation")), "Should include citation count");
  assert.ok(texts.some((t) => t.includes("3 independent source")), "Should include source count");
  assert.ok(texts.some((t) => t.includes("10 years")), "Should include source age");
});

test("buildPromptConstraints with specification produces source policy rules", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
  });

  const policyRules = constraints.universal.filter((r) => r.category === "source_policy");
  assert.ok(policyRules.length >= 1, "Should have source policy rules");

  const texts = policyRules.map((r) => r.text);
  assert.ok(texts.some((t) => t.includes("preprint")), "Should restrict preprints");
  assert.ok(texts.some((t) => t.includes("peer-reviewed")), "Should require peer review");
});

test("buildPromptConstraints with contentStandards produces forbidden content rules", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    contentStandards: makeContentStandards(),
  });

  const forbiddenRules = constraints.universal.filter((r) => r.category === "forbidden_content");
  assert.ok(forbiddenRules.length >= 1, "Should have forbidden content rules");
  assert.ok(
    forbiddenRules.some((r) => r.text.includes("miracle cure")),
    "Should include forbidden phrase"
  );
});

test("buildPromptConstraints with contentStandards produces brand rules", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    contentStandards: makeContentStandards(),
  });

  const brandRules = constraints.universal.filter((r) => r.category === "brand");
  assert.ok(brandRules.length >= 1, "Should have brand alignment rules");
  assert.ok(
    brandRules.some((r) => r.text.includes("vegan")),
    "Should include vegan alignment"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. DIRECTIONAL CONSTRAINT GENERATION
// ═══════════════════════════════════════════════════════════════════════════

section("Directional Constraints");

test("helps topic gets exclusion: do not include harms evidence", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(), // direction = "helps"
  });

  const exclusions = constraints.directional.filter((r) => r.category === "exclusion");
  assert.ok(exclusions.length >= 1);
  assert.ok(
    exclusions.some((r) => r.text.includes("harms") && r.text.includes("turmeric")),
    "Should exclude harms evidence for helps topic"
  );
});

test("harms topic gets exclusion: do not include helps evidence", () => {
  const dairyTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum production", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const constraints = buildPromptConstraints({ topic: dairyTopic });

  const exclusions = constraints.directional.filter((r) => r.category === "exclusion");
  assert.ok(
    exclusions.some((r) => r.text.includes("helps") && r.text.includes("dairy")),
    "Should exclude helps evidence for harms topic"
  );
  assert.ok(
    exclusions.some((r) => r.text.includes("normalizes") || r.text.includes("minimizes")),
    "Should prevent minimizing harmful effect"
  );
});

test("animal category gets ethical and vegan-alternative constraints", () => {
  const dairyTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum production", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const constraints = buildPromptConstraints({ topic: dairyTopic });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(allText.includes("welfare") || allText.includes("ethical"), "Should include welfare/ethical considerations");
  assert.ok(allText.includes("plant-based") || allText.includes("vegan"), "Should reference alternatives");
});

test("skincare chemicals category gets regulatory constraint", () => {
  const parabenTopic = makeTopic({
    id: "parabens_harm_oily",
    primaryEntity: "parabens",
    entityType: "chemical",
    claim: { direction: "harms", mechanism: "disrupts endocrine function", confidence: "emerging" },
    name: "Parabens Worsen Oily Skin",
    condition: "oily_skin",
    category: "skincare_chemicals_that_harm_skin",
  });

  const constraints = buildPromptConstraints({ topic: parabenTopic });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(allText.includes("FDA") || allText.includes("EU SCCS"), "Should reference regulatory bodies");
  assert.ok(allText.includes("industry-funded"), "Should flag industry-funded studies");
});

test("habits category gets modifiable-behavior constraint", () => {
  const habitTopic = makeTopic({
    id: "face_touching_harms_acne",
    primaryEntity: "face touching",
    entityType: "habit",
    claim: { direction: "harms", mechanism: "transfers bacteria to skin", confidence: "established" },
    name: "Face Touching Worsens Acne",
    condition: "acne_acne_scars",
    category: "habits_that_harm_skin",
  });

  const constraints = buildPromptConstraints({ topic: habitTopic });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(allText.includes("modifiable"), "Should focus on modifiable behaviors");
  assert.ok(allText.includes("genetic"), "Should exclude genetic predispositions");
});

test("ayurvedic herb gets traditional-vs-clinical constraint", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(), // turmeric, herb, ayurvedic_herbs_in_skincare_that_help_skin
  });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(
    allText.includes("traditional") && allText.includes("clinical"),
    "Should distinguish traditional from clinical evidence"
  );
});

test("preliminary confidence gets evidence-limitation constraint", () => {
  const prelimTopic = makeTopic({
    id: "kale_helps_redness",
    primaryEntity: "kale",
    entityType: "food",
    claim: { direction: "helps", mechanism: "antioxidant vitamin C", confidence: "preliminary" },
    name: "Kale Reduces Redness",
    condition: "redness_hyperpigmentation",
    category: "vegan_foods_that_help_skin",
  });

  const constraints = buildPromptConstraints({ topic: prelimTopic });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(allText.includes("preliminary"), "Should flag preliminary evidence");
  assert.ok(allText.includes("in-vitro") || allText.includes("animal"), "Should mention study limitations");
});

test("emerging confidence gets hedging-language constraint", () => {
  const emergingTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum production", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const constraints = buildPromptConstraints({ topic: emergingTopic });

  const allText = constraints.directional.map((r) => r.text).join(" ");
  assert.ok(allText.includes("suggests") || allText.includes("may"), "Should require hedging language");
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. CONSTRAINT DETERMINISM & STABILITY
// ═══════════════════════════════════════════════════════════════════════════

section("Constraint Determinism");

test("same inputs produce identical constraints", () => {
  const input = {
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
  };

  const first = buildPromptConstraints(input);
  const second = buildPromptConstraints(input);

  const firstText = formatConstraints(first);
  const secondText = formatConstraints(second);

  assert.equal(firstText, secondText, "Constraint text must be stable across calls");
});

test("constraint text is stable across renders", () => {
  const input = {
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
  };

  const constraints = buildPromptConstraints(input);
  const text1 = formatConstraints(constraints);
  const text2 = formatConstraints(constraints);

  assert.equal(text1, text2, "formatConstraints must be deterministic");
});

test("different topics produce different directional constraints", () => {
  const helpsTopic = makeTopic();
  const harmsTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum production", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const helpsConstraints = buildPromptConstraints({ topic: helpsTopic });
  const harmsConstraints = buildPromptConstraints({ topic: harmsTopic });

  const helpsText = formatConstraints(helpsConstraints);
  const harmsText = formatConstraints(harmsConstraints);

  assert.notEqual(helpsText, harmsText, "Different directions must produce different constraints");
  assert.ok(helpsText.includes("turmeric"), "Should reference helps entity");
  assert.ok(harmsText.includes("dairy"), "Should reference harms entity");
});

test("countConstraints returns correct total", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
  });

  const total = countConstraints(constraints);
  assert.equal(total, constraints.universal.length + constraints.directional.length);
  assert.ok(total > 5, "Full input should produce many constraints");
});

test("constraints are frozen", () => {
  const constraints = buildPromptConstraints({ topic: makeTopic() });

  assert.ok(Object.isFrozen(constraints));
  assert.ok(Object.isFrozen(constraints.universal));
  assert.ok(Object.isFrozen(constraints.directional));
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. CONSTRAINT FORMATTING
// ═══════════════════════════════════════════════════════════════════════════

section("Constraint Formatting");

test("formatConstraints includes heading and subheadings", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
  });

  const text = formatConstraints(constraints);
  assert.ok(text.includes("## Constraints & Exclusions"), "Should have main heading");
  assert.ok(text.includes("### Universal Constraints"), "Should have universal subheading");
  assert.ok(text.includes("### Topic-Specific Constraints"), "Should have directional subheading");
});

test("formatConstraints includes category labels", () => {
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
    contentStandards: makeContentStandards(),
  });

  const text = formatConstraints(constraints);
  assert.ok(text.includes("[evidence]"), "Should have evidence category label");
  assert.ok(text.includes("[source_policy]"), "Should have source_policy category label");
  assert.ok(text.includes("[exclusion]"), "Should have exclusion category label");
});

test("formatConstraints with no rules produces fallback message", () => {
  // Build constraints with no spec or standards, for a topic with no special
  // category characteristics that would still produce directional rules.
  // Actually, every topic gets directional rules. So we verify the fallback
  // by formatting an empty PromptConstraints.
  const empty: PromptConstraints = { universal: [], directional: [] };
  const text = formatConstraints(empty);
  assert.ok(text.includes("No additional constraints"), "Should have fallback message");
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. CONSTRAINT INJECTION IN RENDERER
// ═══════════════════════════════════════════════════════════════════════════

section("Constraint Injection");

test("renderPrompt appends constraints when provided", () => {
  const source = "Topic: {{topic.entity}}.";
  const template = parseTemplate(source, "inject-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
  });

  const result = renderPrompt(template, ctx, { strict: false, constraints });

  assert.ok(result.startsWith("Topic: turmeric."), "Should start with template content");
  assert.ok(result.includes("## Constraints & Exclusions"), "Should include constraint heading");
  assert.ok(result.includes("[evidence]"), "Should include constraint rules");
});

test("renderPrompt without constraints produces no constraint section", () => {
  const source = "Topic: {{topic.entity}}.";
  const template = parseTemplate(source, "no-inject-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const result = renderPrompt(template, ctx, { strict: false });

  assert.ok(!result.includes("Constraints & Exclusions"), "Should not include constraints");
  assert.equal(result, "Topic: turmeric.");
});

test("constraints are appended after all template processing", () => {
  const source =
    '{{#if topic.claim.direction == "helps"}}BENEFIT.{{/if}}\n' +
    "Entity: {{topic.entity}}.";
  const template = parseTemplate(source, "order-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const constraints = buildPromptConstraints({ topic: makeTopic() });

  const result = renderPrompt(template, ctx, { strict: false, constraints });

  // Find positions: template content should come before constraints
  const benefitPos = result.indexOf("BENEFIT.");
  const entityPos = result.indexOf("Entity: turmeric.");
  const constraintPos = result.indexOf("## Constraints & Exclusions");

  assert.ok(benefitPos < entityPos, "Conditional content before variable content");
  assert.ok(entityPos < constraintPos, "Template content before constraints");
});

test("same template + different topics produce different constraint sections", () => {
  const source = "Research: {{topic.entity}}.";
  const template = parseTemplate(source, "diff-constraints");

  const helpsTopic = makeTopic();
  const harmsTopic = makeTopic({
    id: "dairy_harms_acne",
    primaryEntity: "dairy",
    entityType: "food",
    claim: { direction: "harms", mechanism: "hormones stimulate sebum", confidence: "emerging" },
    name: "Dairy Worsens Acne",
    condition: "acne_acne_scars",
    category: "animal_ingredients_in_food_that_harm_skin",
  });

  const helpsCtx = buildPromptContext({ topic: helpsTopic });
  const harmsCtx = buildPromptContext({ topic: harmsTopic });

  const helpsConstraints = buildPromptConstraints({ topic: helpsTopic });
  const harmsConstraints = buildPromptConstraints({ topic: harmsTopic });

  const helpsResult = renderPrompt(template, helpsCtx, { strict: false, constraints: helpsConstraints });
  const harmsResult = renderPrompt(template, harmsCtx, { strict: false, constraints: harmsConstraints });

  // Both should have constraint sections
  assert.ok(helpsResult.includes("## Constraints & Exclusions"));
  assert.ok(harmsResult.includes("## Constraints & Exclusions"));

  // But constraint content should differ
  assert.ok(helpsResult.includes('"turmeric" harms'), "Helps should exclude harms evidence");
  assert.ok(harmsResult.includes('"dairy" helps'), "Harms should exclude helps evidence");

  // Harms/animal topic should have additional constraints
  assert.ok(harmsResult.includes("welfare") || harmsResult.includes("ethical"));
});

test("constraints cannot be bypassed by template content", () => {
  // Even if a template tries to include its own "Constraints" section,
  // the real constraints are appended at the very end.
  const source = "## Constraints & Exclusions\nFake constraints here.\n\nEntity: {{topic.entity}}.";
  const template = parseTemplate(source, "bypass-test");

  const ctx = buildPromptContext({ topic: makeTopic() });
  const constraints = buildPromptConstraints({
    topic: makeTopic(),
    specification: makeSpecification(),
  });

  const result = renderPrompt(template, ctx, { strict: false, constraints });

  // Count occurrences of the heading
  const headingMatches = result.match(/## Constraints & Exclusions/g);
  assert.equal(headingMatches?.length, 2, "Should have both template and injected headings");

  // The real constraints (from the injected section) should appear after the fake one
  const fakePos = result.indexOf("Fake constraints here.");
  const realPos = result.indexOf("[evidence]");
  assert.ok(realPos > fakePos, "Real constraints appear after any template content");
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP & SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

cleanupLoaderDir();

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) {
  process.exit(1);
}
