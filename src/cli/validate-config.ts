#!/usr/bin/env node
/**
 * CLI command to validate the Phase 1 configuration stack.
 *
 * Validates:
 * - ResearchConfig
 * - Topics (against ResearchConfig)
 * - Content Standards
 * - SEO Guidelines
 * - Full ResearchSpecification assembly
 *
 * Usage:
 *   npx tsx src/cli/validate-config.ts [options]
 *   npm run validate-config
 *
 * Options:
 *   --topics <path>     Path to topics JSON (default: topics/sample-topics.json)
 *   --standards <path>  Path to content standards JSON (default: config/content-standards.json)
 *   --seo <path>        Path to SEO guidelines JSON (default: config/seo-guidelines.json)
 *   --verbose           Show detailed output
 *   --json              Output as JSON (for CI parsing)
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 *
 * EXAMPLE OUTPUT (SUCCESS):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  $ npm run validate-config                                     │
 * │                                                                 │
 * │  ═══════════════════════════════════════════════════════════   │
 * │   Phase 1 Configuration Validation                             │
 * │  ═══════════════════════════════════════════════════════════   │
 * │                                                                 │
 * │  ✓ ResearchConfig loaded                                       │
 * │    • Supported conditions: 10                                  │
 * │    • Supported categories: 6                                   │
 * │    • Output formats: 4                                         │
 * │                                                                 │
 * │  ✓ Topics loaded: 13                                           │
 * │    • Active: 12, Draft: 1                                      │
 * │    • By condition:                                             │
 * │        acne: 3, eczema: 3, psoriasis: 2, ...                  │
 * │    • By category:                                              │
 * │        treatment_options: 6, prevention: 2, ...                │
 * │                                                                 │
 * │  ✓ Content Standards loaded: ABA Research Content Standards    │
 * │    • Tone: educational, informative, supportive                │
 * │    • Forbidden phrases: 6                                      │
 * │    • Required disclaimers: 2                                   │
 * │                                                                 │
 * │  ✓ SEO Guidelines loaded: ABA Research SEO Guidelines          │
 * │    • Word count: 1200-2500                                     │
 * │    • Keyword density: 1-2.5%                                   │
 * │                                                                 │
 * │  ✓ ResearchSpecification assembled                             │
 * │    • Version: 1.0.0                                            │
 * │    • Run ID: 20260206-abc123                                   │
 * │                                                                 │
 * │  ───────────────────────────────────────────────────────────   │
 * │  ✓ All validations passed                                      │
 * │  ───────────────────────────────────────────────────────────   │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * EXAMPLE OUTPUT (FAILURE):
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  $ npm run validate-config                                     │
 * │                                                                 │
 * │  ═══════════════════════════════════════════════════════════   │
 * │   Phase 1 Configuration Validation                             │
 * │  ═══════════════════════════════════════════════════════════   │
 * │                                                                 │
 * │  ✓ ResearchConfig loaded                                       │
 * │                                                                 │
 * │  ✗ Topics validation failed                                    │
 * │    • [acne_invalid_category] category: Category "unknown"      │
 * │      is not in ResearchConfig.supportedCategories              │
 * │    • [duplicate_topic] id: Duplicate topic ID                  │
 * │                                                                 │
 * │  ✗ Content Standards not found: config/content-standards.json  │
 * │                                                                 │
 * │  ───────────────────────────────────────────────────────────   │
 * │  ✗ Validation failed: 2 errors                                 │
 * │  ───────────────────────────────────────────────────────────   │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
  ResearchConfigError,
} from "../config/index.js";
import {
  loadTopics,
  TopicRegistry,
  TopicValidationError,
} from "../topics/index.js";
import {
  loadContentStandards,
  loadSeoGuidelines,
  StandardsValidationError,
} from "../standards/index.js";
import {
  createSpecification,
  summarizeSpecification,
} from "../specification/index.js";
import { generateRunId } from "../logging/index.js";

// ============================================================
// Types
// ============================================================

interface ValidationResult {
  success: boolean;
  component: string;
  message: string;
  details?: string[];
}

interface ValidationReport {
  timestamp: string;
  results: ValidationResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
  stats?: {
    topics: {
      total: number;
      active: number;
      draft: number;
      byCondition: Record<string, number>;
      byCategory: Record<string, number>;
    };
    config: {
      conditions: number;
      categories: number;
      outputFormats: number;
    };
  };
}

// ============================================================
// CLI Parsing
// ============================================================

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      topics: { type: "string", default: "topics/sample-topics.json" },
      standards: { type: "string", default: "config/content-standards.json" },
      seo: { type: "string", default: "config/seo-guidelines.json" },
      verbose: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: validate-config [options]

Options:
  --topics <path>     Path to topics JSON (default: topics/sample-topics.json)
  --standards <path>  Path to content standards JSON (default: config/content-standards.json)
  --seo <path>        Path to SEO guidelines JSON (default: config/seo-guidelines.json)
  --verbose           Show detailed output
  --json              Output as JSON (for CI parsing)
  -h, --help          Show this help message
`);
    process.exit(0);
  }

  return values;
}

// ============================================================
// Output Formatting
// ============================================================

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

// Detect if colors should be used
const useColors = process.stdout.isTTY && !process.env.NO_COLOR;

function c(color: keyof typeof COLORS, text: string): string {
  return useColors ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function printHeader(): void {
  console.log("");
  console.log(c("bold", "═".repeat(60)));
  console.log(c("bold", " Phase 1 Configuration Validation"));
  console.log(c("bold", "═".repeat(60)));
  console.log("");
}

function printSuccess(component: string, message: string): void {
  console.log(`${c("green", "✓")} ${c("bold", component)}: ${message}`);
}

function printFailure(component: string, message: string): void {
  console.log(`${c("red", "✗")} ${c("bold", component)}: ${message}`);
}

function printDetail(text: string, indent = 2): void {
  const spaces = " ".repeat(indent);
  console.log(`${spaces}${c("dim", "•")} ${text}`);
}

function printError(text: string, indent = 4): void {
  const spaces = " ".repeat(indent);
  console.log(`${spaces}${c("red", "•")} ${text}`);
}

function printFooter(passed: number, failed: number): void {
  console.log("");
  console.log("─".repeat(60));
  if (failed === 0) {
    console.log(c("green", `✓ All validations passed (${passed}/${passed})`));
  } else {
    console.log(c("red", `✗ Validation failed: ${failed} error(s)`));
  }
  console.log("─".repeat(60));
  console.log("");
}

// ============================================================
// Validation Functions
// ============================================================

function validateResearchConfig(): ValidationResult {
  try {
    const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);
    return {
      success: true,
      component: "ResearchConfig",
      message: "loaded",
      details: [
        `Supported conditions: ${config.supportedConditions.length}`,
        `Supported categories: ${config.supportedCategories.length}`,
        `Output formats: ${config.allowedOutputFormats.length}`,
      ],
    };
  } catch (err) {
    const message = err instanceof ResearchConfigError
      ? err.format()
      : String(err);
    return {
      success: false,
      component: "ResearchConfig",
      message: "validation failed",
      details: [message],
    };
  }
}

function validateTopics(
  topicsPath: string,
  researchConfig: ReturnType<typeof loadResearchConfig>
): ValidationResult {
  // Check file exists
  if (!existsSync(topicsPath)) {
    return {
      success: false,
      component: "Topics",
      message: `file not found: ${topicsPath}`,
    };
  }

  try {
    const topicData = JSON.parse(readFileSync(topicsPath, "utf-8"));
    const result = loadTopics(topicData, researchConfig);

    if (!result.success) {
      return {
        success: false,
        component: "Topics",
        message: "validation failed",
        details: result.errors?.map(
          (e) => `[${e.topicId ?? "collection"}] ${e.field}: ${e.message}`
        ),
      };
    }

    const registry = TopicRegistry.create(result.topics!);
    const stats = registry.getStats();

    // Build condition/category breakdowns
    const byCondition: string[] = [];
    for (const condition of registry.getConditions()) {
      byCondition.push(`${condition}: ${registry.getByCondition(condition).length}`);
    }

    const byCategory: string[] = [];
    for (const category of registry.getCategories()) {
      byCategory.push(`${category}: ${registry.getByCategory(category).length}`);
    }

    return {
      success: true,
      component: "Topics",
      message: `loaded ${stats.totalTopics} topics`,
      details: [
        `Active: ${stats.byStatus.active}, Draft: ${stats.byStatus.draft}, Archived: ${stats.byStatus.archived}`,
        `By condition: ${byCondition.join(", ")}`,
        `By category: ${byCategory.join(", ")}`,
      ],
    };
  } catch (err) {
    return {
      success: false,
      component: "Topics",
      message: err instanceof SyntaxError ? "invalid JSON" : String(err),
    };
  }
}

function validateContentStandards(standardsPath: string): ValidationResult {
  if (!existsSync(standardsPath)) {
    return {
      success: false,
      component: "Content Standards",
      message: `file not found: ${standardsPath}`,
    };
  }

  try {
    const json = readFileSync(standardsPath, "utf-8");
    const standards = loadContentStandards(json);

    return {
      success: true,
      component: "Content Standards",
      message: standards.name,
      details: [
        `Tone: ${standards.tone.primary.join(", ")}`,
        `Forbidden phrases: ${standards.forbidden.exactPhrases.length}`,
        `Required disclaimers: ${standards.required.disclaimers.length}`,
        `Brand values: ${standards.brand.values.join(", ")}`,
      ],
    };
  } catch (err) {
    const message = err instanceof StandardsValidationError
      ? err.format()
      : String(err);
    return {
      success: false,
      component: "Content Standards",
      message: "validation failed",
      details: [message],
    };
  }
}

function validateSeoGuidelines(seoPath: string): ValidationResult {
  if (!existsSync(seoPath)) {
    return {
      success: false,
      component: "SEO Guidelines",
      message: `file not found: ${seoPath}`,
    };
  }

  try {
    const json = readFileSync(seoPath, "utf-8");
    const guidelines = loadSeoGuidelines(json);

    return {
      success: true,
      component: "SEO Guidelines",
      message: guidelines.name,
      details: [
        `Word count: ${guidelines.contentLength.wordCount.min}-${guidelines.contentLength.wordCount.max}`,
        `Keyword density: ${guidelines.keywordDensity.primaryKeyword.min}-${guidelines.keywordDensity.primaryKeyword.max}%`,
        `Min H2 headings: ${guidelines.headingStructure.minH2Count}`,
      ],
    };
  } catch (err) {
    const message = err instanceof StandardsValidationError
      ? err.format()
      : String(err);
    return {
      success: false,
      component: "SEO Guidelines",
      message: "validation failed",
      details: [message],
    };
  }
}

function validateSpecificationAssembly(
  researchConfig: ReturnType<typeof loadResearchConfig>,
  topicsPath: string,
  standardsPath: string,
  seoPath: string
): ValidationResult {
  try {
    // Load all components
    const topicData = JSON.parse(readFileSync(topicsPath, "utf-8"));
    const topicsResult = loadTopics(topicData, researchConfig);
    if (!topicsResult.success) {
      return {
        success: false,
        component: "Specification Assembly",
        message: "topics invalid (see above)",
      };
    }

    const contentStandards = existsSync(standardsPath)
      ? loadContentStandards(readFileSync(standardsPath, "utf-8"))
      : undefined;

    const seoGuidelines = existsSync(seoPath)
      ? loadSeoGuidelines(readFileSync(seoPath, "utf-8"))
      : undefined;

    const runId = generateRunId();
    const spec = createSpecification({
      runId,
      researchConfig,
      topics: topicsResult.topics!,
      contentStandards,
      seoGuidelines,
      initiatedBy: "validate-config",
    });

    return {
      success: true,
      component: "Specification Assembly",
      message: "complete",
      details: [
        `Version: ${spec.specificationVersion}`,
        `Run ID: ${spec.runMetadata.runId}`,
        `Topics: ${spec.stats.totalTopics} (${spec.stats.activeTopics} active)`,
        `Content Standards: ${spec.contentStandards ? "included" : "not included"}`,
        `SEO Guidelines: ${spec.seoGuidelines ? "included" : "not included"}`,
      ],
    };
  } catch (err) {
    return {
      success: false,
      component: "Specification Assembly",
      message: String(err),
    };
  }
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = parseCliArgs();
  const results: ValidationResult[] = [];

  // Resolve paths relative to cwd
  const topicsPath = resolve(args.topics!);
  const standardsPath = resolve(args.standards!);
  const seoPath = resolve(args.seo!);

  // Run validations
  if (!args.json) {
    printHeader();
  }

  // 1. ResearchConfig
  const configResult = validateResearchConfig();
  results.push(configResult);

  if (!args.json) {
    if (configResult.success) {
      printSuccess(configResult.component, configResult.message);
      if (args.verbose && configResult.details) {
        configResult.details.forEach((d) => printDetail(d));
      }
    } else {
      printFailure(configResult.component, configResult.message);
      configResult.details?.forEach((d) => printError(d));
    }
    console.log("");
  }

  // Get config for subsequent validations
  const researchConfig = configResult.success
    ? loadResearchConfig(DEFAULT_RESEARCH_CONFIG)
    : null;

  // 2. Topics
  if (researchConfig) {
    const topicsResult = validateTopics(topicsPath, researchConfig);
    results.push(topicsResult);

    if (!args.json) {
      if (topicsResult.success) {
        printSuccess(topicsResult.component, topicsResult.message);
        if (args.verbose && topicsResult.details) {
          topicsResult.details.forEach((d) => printDetail(d));
        }
      } else {
        printFailure(topicsResult.component, topicsResult.message);
        topicsResult.details?.forEach((d) => printError(d));
      }
      console.log("");
    }
  }

  // 3. Content Standards
  const standardsResult = validateContentStandards(standardsPath);
  results.push(standardsResult);

  if (!args.json) {
    if (standardsResult.success) {
      printSuccess(standardsResult.component, standardsResult.message);
      if (args.verbose && standardsResult.details) {
        standardsResult.details.forEach((d) => printDetail(d));
      }
    } else {
      printFailure(standardsResult.component, standardsResult.message);
      standardsResult.details?.forEach((d) => printError(d));
    }
    console.log("");
  }

  // 4. SEO Guidelines
  const seoResult = validateSeoGuidelines(seoPath);
  results.push(seoResult);

  if (!args.json) {
    if (seoResult.success) {
      printSuccess(seoResult.component, seoResult.message);
      if (args.verbose && seoResult.details) {
        seoResult.details.forEach((d) => printDetail(d));
      }
    } else {
      printFailure(seoResult.component, seoResult.message);
      seoResult.details?.forEach((d) => printError(d));
    }
    console.log("");
  }

  // 5. Specification Assembly (only if config loaded)
  if (researchConfig) {
    const specResult = validateSpecificationAssembly(
      researchConfig,
      topicsPath,
      standardsPath,
      seoPath
    );
    results.push(specResult);

    if (!args.json) {
      if (specResult.success) {
        printSuccess(specResult.component, specResult.message);
        if (args.verbose && specResult.details) {
          specResult.details.forEach((d) => printDetail(d));
        }
      } else {
        printFailure(specResult.component, specResult.message);
        specResult.details?.forEach((d) => printError(d));
      }
    }
  }

  // Summary
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (args.json) {
    const report: ValidationReport = {
      timestamp: new Date().toISOString(),
      results,
      summary: { passed, failed, total: results.length },
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    printFooter(passed, failed);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
