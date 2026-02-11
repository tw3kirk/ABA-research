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
// CLEANUP & SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

cleanupLoaderDir();

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════\n`);

if (failed > 0) {
  process.exit(1);
}
