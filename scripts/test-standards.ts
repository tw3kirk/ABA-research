#!/usr/bin/env node
/**
 * Test script for content standards and SEO guidelines.
 * Validates loading, normalization, and integration with ResearchSpecification.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadContentStandards,
  loadSeoGuidelines,
  loadContentStandardsFromFile,
  loadSeoGuidelinesFromFile,
  validateContentStandards,
  validateSeoGuidelines,
  StandardsValidationError,
} from "../src/standards/index.js";
import {
  createSpecification,
  summarizeSpecification,
} from "../src/specification/index.js";
import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
} from "../src/config/index.js";
import { loadTopicsOrThrow } from "../src/topics/index.js";
import { generateRunId } from "../src/logging/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, "../config");
const TOPICS_FILE = join(__dirname, "../topics/sample-topics.json");

console.log("=== Content Standards & SEO Guidelines Test ===\n");

// Load content standards from file
console.log("1. Loading content standards from file...");
const contentStandards = loadContentStandardsFromFile(
  join(CONFIG_DIR, "content-standards.json")
);
console.log(`   ✓ Loaded: ${contentStandards.name}`);
console.log(`   - Version: ${contentStandards.version}`);
console.log(`   - Primary tone: ${contentStandards.tone.primary.join(", ")}`);
console.log(`   - Citation format: ${contentStandards.citations.format}`);
console.log(`   - Forbidden phrases: ${contentStandards.forbidden.exactPhrases.length}`);
console.log(`   - Brand values: ${contentStandards.brand.values.join(", ")}`);

// Load SEO guidelines from file
console.log("\n2. Loading SEO guidelines from file...");
const seoGuidelines = loadSeoGuidelinesFromFile(
  join(CONFIG_DIR, "seo-guidelines.json")
);
console.log(`   ✓ Loaded: ${seoGuidelines.name}`);
console.log(`   - Version: ${seoGuidelines.version}`);
console.log(`   - Word count: ${seoGuidelines.contentLength.wordCount.min}-${seoGuidelines.contentLength.wordCount.max}`);
console.log(`   - Keyword density: ${seoGuidelines.keywordDensity.primaryKeyword.min}-${seoGuidelines.keywordDensity.primaryKeyword.max}%`);
console.log(`   - Flesch reading ease: ${seoGuidelines.readability.fleschReadingEase.min}-${seoGuidelines.readability.fleschReadingEase.max}`);

// Test immutability
console.log("\n3. Testing immutability...");
try {
  // @ts-expect-error - Testing runtime immutability
  contentStandards.tone.primary = [];
  console.log("   ✗ Content standards should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ Content standards are immutable");
}

try {
  // @ts-expect-error - Testing runtime immutability
  seoGuidelines.keywordDensity.primaryKeyword.min = 999;
  console.log("   ✗ SEO guidelines should be immutable");
  process.exit(1);
} catch {
  console.log("   ✓ SEO guidelines are immutable");
}

// Test normalization (arrays should be sorted)
console.log("\n4. Testing normalization...");
const rawStandards = JSON.parse(readFileSync(join(CONFIG_DIR, "content-standards.json"), "utf-8"));
const normalized = loadContentStandards(rawStandards);

// Check that primary tones are sorted
const primarySorted = [...normalized.tone.primary].sort();
const isSorted = normalized.tone.primary.every((v, i) => v === primarySorted[i]);
if (isSorted) {
  console.log("   ✓ Arrays are normalized (sorted)");
} else {
  console.log("   ✗ Arrays should be sorted");
  process.exit(1);
}

// Test validation error handling
console.log("\n5. Testing validation error handling...");

// Missing required field
const invalidStandards1 = { version: "1.0.0" };
const result1 = validateContentStandards(invalidStandards1);
if (!result1.success && result1.errors) {
  console.log(`   ✓ Missing fields rejected (${result1.errors.length} errors)`);
} else {
  console.log("   ✗ Should reject missing fields");
  process.exit(1);
}

// Invalid range (min > max)
const invalidSeo = {
  version: "1.0.0",
  name: "Invalid",
  keywordDensity: {
    primaryKeyword: { min: 10, max: 1 }, // Invalid: min > max
  },
  headingStructure: {
    requireSingleH1: true,
    minH2Count: 2,
    maxDepth: 4,
    requireProperHierarchy: true,
    keywordInH2Percentage: 50,
    maxHeadingWords: 10,
  },
  contentLength: {
    wordCount: { min: 1000, max: 2000 },
  },
  metaContent: {},
  linkMedia: {},
  readability: {},
};
const result2 = validateSeoGuidelines(invalidSeo);
if (!result2.success && result2.errors?.some((e) => e.code === "invalid_range")) {
  console.log("   ✓ Invalid range rejected");
} else {
  console.log("   ✗ Should reject invalid range");
  process.exit(1);
}

// Contradictory tone settings
const contradictoryTone = {
  version: "1.0.0",
  name: "Contradictory",
  tone: {
    primary: ["educational", "informative"],
    secondary: [],
    avoid: ["educational"], // Contradiction: educational is both primary and avoided
  },
  citations: { requireInlineCitations: true, format: "numeric", requireReferencesSection: true, minReferences: 1, citationRequiredFor: [] },
  forbidden: { exactPhrases: [], patterns: [], forbiddenClaims: [], avoidWords: [] },
  required: { disclaimers: [], sections: [], elements: [] },
  brand: { values: [], dietaryAlignment: [], emphasize: [], deemphasize: [] },
};
const result3 = validateContentStandards(contradictoryTone);
if (!result3.success && result3.errors?.some((e) => e.code === "contradiction")) {
  console.log("   ✓ Contradictory tone rejected");
} else {
  console.log("   ✗ Should reject contradictory tone");
  process.exit(1);
}

// Test integration with ResearchSpecification
console.log("\n6. Testing integration with ResearchSpecification...");
const researchConfig = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
const topicData = JSON.parse(readFileSync(TOPICS_FILE, "utf-8"));
const topics = loadTopicsOrThrow(topicData, researchConfig);

const spec = createSpecification({
  runId: generateRunId(),
  researchConfig,
  topics,
  contentStandards,
  seoGuidelines,
  initiatedBy: "test-script",
});

console.log("   ✓ Specification created with standards");
console.log(`   - Content standards: ${spec.contentStandards?.name}`);
console.log(`   - SEO guidelines: ${spec.seoGuidelines?.name}`);

// Test summary includes standards
console.log("\n7. Testing summary generation...");
const summary = summarizeSpecification(spec, { includeConfig: true });
if (summary.includes("Content Standards") && summary.includes("SEO Guidelines")) {
  console.log("   ✓ Summary includes standards sections");
} else {
  console.log("   ✗ Summary should include standards");
  process.exit(1);
}

// Display summary excerpt
console.log("\n   Summary excerpt:");
const lines = summary.split("\n");
const standardsStart = lines.findIndex((l) => l.includes("Content Standards"));
if (standardsStart >= 0) {
  lines.slice(standardsStart, standardsStart + 15).forEach((line) => {
    console.log(`   ${line}`);
  });
}

// Test forbidden content structure
console.log("\n8. Examining forbidden content structure...");
console.log(`   Exact phrases: ${contentStandards.forbidden.exactPhrases.length}`);
contentStandards.forbidden.exactPhrases.slice(0, 3).forEach((phrase) => {
  console.log(`     - "${phrase}"`);
});
console.log(`   Patterns: ${contentStandards.forbidden.patterns.length}`);
contentStandards.forbidden.patterns.slice(0, 2).forEach((p) => {
  console.log(`     - ${p.pattern} (${p.severity})`);
});
console.log(`   Forbidden claims: ${contentStandards.forbidden.forbiddenClaims.length}`);
contentStandards.forbidden.forbiddenClaims.forEach((c) => {
  console.log(`     - ${c.category}: ${c.description.substring(0, 50)}...`);
});

// Test required content structure
console.log("\n9. Examining required content structure...");
console.log(`   Disclaimers: ${contentStandards.required.disclaimers.length}`);
contentStandards.required.disclaimers.forEach((d) => {
  console.log(`     - ${d.id}: ${d.text.substring(0, 50)}...`);
});
console.log(`   Required elements: ${contentStandards.required.elements.join(", ")}`);

// Test brand alignment
console.log("\n10. Examining brand alignment...");
console.log(`   Dietary alignment: ${contentStandards.brand.dietaryAlignment.join(", ")}`);
console.log(`   Emphasize: ${contentStandards.brand.emphasize.slice(0, 3).join(", ")}`);
console.log(`   De-emphasize: ${contentStandards.brand.deemphasize.slice(0, 3).join(", ")}`);

console.log("\n=== All tests passed ===");
