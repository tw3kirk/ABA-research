#!/usr/bin/env node
/**
 * CLI command to validate the Phase 1 configuration stack.
 *
 * Validates:
 * - ResearchConfig
 * - Topics (schema + atomicity)
 * - Content Standards
 * - SEO Guidelines
 * - Full ResearchSpecification assembly
 *
 * Reports:
 * - Number of atomic vs non-atomic topics
 * - Breakdown by skin condition + claim direction
 * - Conflicting entries (same entity + claim direction in multiple topics)
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
 *   --json              Output entire report as JSON (for CI parsing)
 *   --strict            Fail immediately on first validation error
 *   --summary           Print only the top-level summary report
 *   -h, --help          Show help
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
  ResearchConfigError,
} from "../config/index.js";
import {
  loadTopics,
  TopicRegistry,
  TopicSchema,
  TopicValidationError,
  validateTopicAtomicity,
  type Topic,
} from "../topics/index.js";
import {
  loadContentStandards,
  loadSeoGuidelines,
  StandardsValidationError,
} from "../standards/index.js";
import {
  createSpecification,
} from "../specification/index.js";
import { generateRunId } from "../logging/index.js";

// ============================================================
// Types
// ============================================================

interface StepResult {
  success: boolean;
  component: string;
  message: string;
  details?: string[];
}

interface AtomicityReport {
  totalTopics: number;
  atomicCount: number;
  nonAtomicCount: number;
  schemaInvalidCount: number;
  warningCount: number;
  nonAtomicTopics: Array<{
    id: string;
    name: string;
    errors: string[];
  }>;
  schemaInvalidTopics: Array<{
    index: number;
    id: string;
    errors: string[];
  }>;
  warningTopics: Array<{
    id: string;
    name: string;
    warnings: string[];
  }>;
}

interface ConditionDirectionEntry {
  condition: string;
  direction: string;
  count: number;
  topics: string[];
}

interface ConflictEntry {
  entity: string;
  condition: string;
  direction: string;
  topicIds: string[];
}

interface TopicAnalysis {
  atomicity: AtomicityReport;
  conditionDirectionBreakdown: ConditionDirectionEntry[];
  conflicts: ConflictEntry[];
}

interface ValidationReport {
  timestamp: string;
  steps: StepResult[];
  topicAnalysis?: TopicAnalysis;
  summary: {
    stepsPassed: number;
    stepsFailed: number;
    stepsTotal: number;
    atomicTopics?: number;
    nonAtomicTopics?: number;
    schemaInvalidTopics?: number;
    topicWarnings?: number;
    conflicts?: number;
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
      strict: { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
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
  --json              Output entire report as JSON (for CI parsing)
  --strict            Fail immediately on first validation error
  --summary           Print only the top-level summary report
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
// Topic Analysis
// ============================================================

/**
 * Parse raw topic objects one-by-one and run atomicity analysis.
 *
 * Topics that fail schema parsing are counted as schema-invalid.
 * Topics that pass schema but fail atomicity are counted as non-atomic.
 * This ensures the report is complete even when some topics are malformed.
 *
 * @param rawTopics - The raw topic array from JSON (pre-schema-parse)
 * @param parsedTopics - Already-parsed topics from loadTopics (may be empty)
 */
function analyzeAtomicity(
  rawTopics: unknown[],
  parsedTopics: Topic[]
): AtomicityReport {
  const nonAtomicTopics: AtomicityReport["nonAtomicTopics"] = [];
  const schemaInvalidTopics: AtomicityReport["schemaInvalidTopics"] = [];
  const warningTopics: AtomicityReport["warningTopics"] = [];
  let atomicCount = 0;

  // If topics loaded successfully, use them for atomicity analysis
  if (parsedTopics.length > 0) {
    for (const topic of parsedTopics) {
      const result = validateTopicAtomicity(topic);

      if (result.errorCount > 0) {
        nonAtomicTopics.push({
          id: topic.id,
          name: topic.name,
          errors: result.issues
            .filter((i) => i.severity === "error")
            .map((i) => `[${i.rule}] ${i.message}`),
        });
      } else {
        atomicCount++;
        if (result.warningCount > 0) {
          warningTopics.push({
            id: topic.id,
            name: topic.name,
            warnings: result.issues
              .filter((i) => i.severity === "warning")
              .map((i) => `[${i.rule}] ${i.message}`),
          });
        }
      }
    }
  } else {
    // Topics didn't load — parse individually to give per-topic breakdown
    for (let i = 0; i < rawTopics.length; i++) {
      const raw = rawTopics[i];
      const parseResult = TopicSchema.safeParse(raw);

      if (!parseResult.success) {
        const rawId =
          typeof raw === "object" && raw !== null && "id" in raw
            ? String((raw as Record<string, unknown>).id)
            : `topic[${i}]`;
        schemaInvalidTopics.push({
          index: i,
          id: rawId,
          errors: parseResult.error.issues.map(
            (iss) => `${iss.path.join(".")}: ${iss.message}`
          ),
        });
      } else {
        const topic = parseResult.data;
        const result = validateTopicAtomicity(topic);

        if (result.errorCount > 0) {
          nonAtomicTopics.push({
            id: topic.id,
            name: topic.name,
            errors: result.issues
              .filter((iss) => iss.severity === "error")
              .map((iss) => `[${iss.rule}] ${iss.message}`),
          });
        } else {
          atomicCount++;
          if (result.warningCount > 0) {
            warningTopics.push({
              id: topic.id,
              name: topic.name,
              warnings: result.issues
                .filter((iss) => iss.severity === "warning")
                .map((iss) => `[${iss.rule}] ${iss.message}`),
            });
          }
        }
      }
    }
  }

  return {
    totalTopics: rawTopics.length,
    atomicCount,
    nonAtomicCount: nonAtomicTopics.length,
    schemaInvalidCount: schemaInvalidTopics.length,
    warningCount: warningTopics.length,
    nonAtomicTopics,
    schemaInvalidTopics,
    warningTopics,
  };
}

function buildConditionDirectionBreakdown(
  topics: Topic[]
): ConditionDirectionEntry[] {
  const map = new Map<
    string,
    { condition: string; direction: string; topics: string[] }
  >();

  for (const topic of topics) {
    const key = `${topic.condition}||${topic.claim.direction}`;
    const existing = map.get(key);
    if (existing) {
      existing.topics.push(topic.id);
    } else {
      map.set(key, {
        condition: topic.condition,
        direction: topic.claim.direction,
        topics: [topic.id],
      });
    }
  }

  return [...map.values()]
    .map((e) => ({ ...e, count: e.topics.length }))
    .sort((a, b) => {
      const cmp = a.condition.localeCompare(b.condition);
      return cmp !== 0 ? cmp : a.direction.localeCompare(b.direction);
    });
}

function detectConflicts(topics: Topic[]): ConflictEntry[] {
  const map = new Map<string, ConflictEntry>();

  for (const topic of topics) {
    const entity = topic.primaryEntity.toLowerCase();
    const key = `${entity}||${topic.condition}||${topic.claim.direction}`;
    const existing = map.get(key);
    if (existing) {
      existing.topicIds.push(topic.id);
    } else {
      map.set(key, {
        entity: topic.primaryEntity,
        condition: topic.condition,
        direction: topic.claim.direction,
        topicIds: [topic.id],
      });
    }
  }

  return [...map.values()]
    .filter((e) => e.topicIds.length > 1)
    .sort((a, b) => a.entity.localeCompare(b.entity));
}

/**
 * Parse raw topics individually and collect the ones that pass schema.
 */
function parseSchemaSafe(rawTopics: unknown[]): Topic[] {
  const parsed: Topic[] = [];
  for (const raw of rawTopics) {
    const result = TopicSchema.safeParse(raw);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

/**
 * Full topic analysis: atomicity, condition x direction, conflicts.
 *
 * @param rawTopics - Raw topic array from JSON
 * @param loadedTopics - Topics from loadTopics (may be empty if load failed)
 */
function analyzeTopics(
  rawTopics: unknown[],
  loadedTopics: Topic[]
): TopicAnalysis {
  // For atomicity: use loadedTopics if available, else parse individually
  const atomicity = analyzeAtomicity(rawTopics, loadedTopics);

  // For breakdown + conflicts: use loadedTopics or individually parsed topics
  const topicsForAnalysis =
    loadedTopics.length > 0 ? loadedTopics : parseSchemaSafe(rawTopics);

  return {
    atomicity,
    conditionDirectionBreakdown:
      buildConditionDirectionBreakdown(topicsForAnalysis),
    conflicts: detectConflicts(topicsForAnalysis),
  };
}

// ============================================================
// Topic Analysis — Printing
// ============================================================

function printAtomicityReport(
  report: AtomicityReport,
  verbose: boolean
): void {
  console.log("");
  console.log(c("bold", "─── Topic Atomicity Report ───"));
  console.log("");

  const pct =
    report.totalTopics > 0
      ? ((report.atomicCount / report.totalTopics) * 100).toFixed(0)
      : "0";
  console.log(`  Total topics:     ${report.totalTopics}`);
  console.log(
    `  Atomic:           ${c("green", String(report.atomicCount))} (${pct}%)`
  );

  if (report.nonAtomicCount > 0) {
    console.log(
      `  Non-atomic:       ${c("red", String(report.nonAtomicCount))}`
    );
  } else {
    console.log(`  Non-atomic:       0`);
  }

  if (report.schemaInvalidCount > 0) {
    console.log(
      `  Schema-invalid:   ${c("red", String(report.schemaInvalidCount))}`
    );
  }

  if (report.warningCount > 0) {
    console.log(
      `  With warnings:    ${c("yellow", String(report.warningCount))}`
    );
  }

  if (report.schemaInvalidTopics.length > 0) {
    console.log("");
    console.log(`  ${c("red", "Schema-invalid topics:")}`);
    for (const t of report.schemaInvalidTopics) {
      console.log(`    ${c("red", "✗")} ${t.id}`);
      if (verbose) {
        for (const err of t.errors) {
          console.log(`        ${err}`);
        }
      }
    }
  }

  if (report.nonAtomicTopics.length > 0) {
    console.log("");
    console.log(`  ${c("red", "Non-atomic topics:")}`);
    for (const t of report.nonAtomicTopics) {
      console.log(`    ${c("red", "✗")} ${t.id} ("${t.name}")`);
      if (verbose) {
        for (const err of t.errors) {
          console.log(`        ${err}`);
        }
      }
    }
  }

  if (verbose && report.warningTopics.length > 0) {
    console.log("");
    console.log(`  ${c("yellow", "Topics with warnings:")}`);
    for (const t of report.warningTopics) {
      console.log(`    ${c("yellow", "!")} ${t.id} ("${t.name}")`);
      for (const w of t.warnings) {
        console.log(`        ${w}`);
      }
    }
  }
}

function printConditionDirectionBreakdown(
  entries: ConditionDirectionEntry[],
  verbose: boolean
): void {
  console.log("");
  console.log(c("bold", "─── Condition x Direction Breakdown ───"));
  console.log("");

  for (const entry of entries) {
    const dir =
      entry.direction === "helps"
        ? c("green", "helps")
        : c("red", "harms");
    console.log(
      `  ${entry.condition} [${dir}]: ${entry.count} topic(s)`
    );
    if (verbose) {
      for (const tid of entry.topics) {
        console.log(`    • ${tid}`);
      }
    }
  }
}

function printConflicts(conflicts: ConflictEntry[]): void {
  console.log("");
  console.log(c("bold", "─── Conflict Detection ───"));
  console.log("");

  if (conflicts.length === 0) {
    console.log(`  ${c("green", "✓")} No conflicting entries detected.`);
    return;
  }

  console.log(
    `  ${c("yellow", `${conflicts.length} conflict(s) found`)} — same entity + condition + direction in multiple topics:`
  );
  console.log("");
  for (const conflict of conflicts) {
    const dir =
      conflict.direction === "helps"
        ? c("green", "helps")
        : c("red", "harms");
    console.log(
      `  ${c("yellow", "!")} "${conflict.entity}" ${dir} ${conflict.condition}`
    );
    console.log(
      `    Appears in ${conflict.topicIds.length} topics: ${conflict.topicIds.join(", ")}`
    );
  }
}

// ============================================================
// Validation Step Functions
// ============================================================

function runConfigStep(): StepResult {
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
    const message =
      err instanceof ResearchConfigError ? err.format() : String(err);
    return {
      success: false,
      component: "ResearchConfig",
      message: "validation failed",
      details: [message],
    };
  }
}

function runTopicsStep(
  topicsPath: string,
  researchConfig: ReturnType<typeof loadResearchConfig>
): { step: StepResult; topics?: Topic[]; rawTopics?: unknown[] } {
  if (!existsSync(topicsPath)) {
    return {
      step: {
        success: false,
        component: "Topics",
        message: `file not found: ${topicsPath}`,
      },
    };
  }

  try {
    const topicData = JSON.parse(readFileSync(topicsPath, "utf-8"));
    // Capture raw array for per-topic analysis even if load fails
    const rawTopics: unknown[] = Array.isArray(topicData)
      ? topicData
      : Array.isArray(topicData?.topics)
        ? topicData.topics
        : [];

    const result = loadTopics(topicData, researchConfig);

    if (!result.success) {
      return {
        step: {
          success: false,
          component: "Topics",
          message: "schema validation failed",
          details: result.errors?.map(
            (e) =>
              `[${e.topicId ?? "collection"}] ${e.field}: ${e.message}`
          ),
        },
        rawTopics,
      };
    }

    const topics = result.topics!;
    const registry = TopicRegistry.create(topics);
    const stats = registry.getStats();

    const byCondition: string[] = [];
    for (const cond of registry.getConditions()) {
      byCondition.push(
        `${cond}: ${registry.getByCondition(cond).length}`
      );
    }

    const byCategory: string[] = [];
    for (const cat of registry.getCategories()) {
      byCategory.push(
        `${cat}: ${registry.getByCategory(cat).length}`
      );
    }

    return {
      step: {
        success: true,
        component: "Topics",
        message: `loaded ${stats.totalTopics} topics`,
        details: [
          `Active: ${stats.byStatus.active}, Draft: ${stats.byStatus.draft}, Archived: ${stats.byStatus.archived}`,
          `By condition: ${byCondition.join(", ")}`,
          `By category: ${byCategory.join(", ")}`,
        ],
      },
      topics,
      rawTopics,
    };
  } catch (err) {
    return {
      step: {
        success: false,
        component: "Topics",
        message:
          err instanceof SyntaxError ? "invalid JSON" : String(err),
      },
    };
  }
}

function runContentStandardsStep(standardsPath: string): StepResult {
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
    const message =
      err instanceof StandardsValidationError
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

function runSeoGuidelinesStep(seoPath: string): StepResult {
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
    const message =
      err instanceof StandardsValidationError
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

function runSpecAssemblyStep(
  researchConfig: ReturnType<typeof loadResearchConfig>,
  topicsPath: string,
  standardsPath: string,
  seoPath: string
): StepResult {
  try {
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
// Report Building
// ============================================================

function buildReport(
  steps: StepResult[],
  analysis?: TopicAnalysis
): ValidationReport {
  const passed = steps.filter((r) => r.success).length;
  const failed = steps.filter((r) => !r.success).length;

  return {
    timestamp: new Date().toISOString(),
    steps,
    topicAnalysis: analysis,
    summary: {
      stepsPassed: passed,
      stepsFailed: failed,
      stepsTotal: steps.length,
      atomicTopics: analysis?.atomicity.atomicCount,
      nonAtomicTopics: analysis?.atomicity.nonAtomicCount,
      schemaInvalidTopics: analysis?.atomicity.schemaInvalidCount,
      topicWarnings: analysis?.atomicity.warningCount,
      conflicts: analysis?.conflicts.length,
    },
  };
}

// ============================================================
// --summary printer
// ============================================================

function printSummary(report: ValidationReport): void {
  console.log("");
  console.log(c("bold", "═".repeat(60)));
  console.log(c("bold", " Validation Summary"));
  console.log(c("bold", "═".repeat(60)));
  console.log("");

  // Steps
  const { stepsPassed, stepsFailed, stepsTotal } = report.summary;
  if (stepsFailed === 0) {
    console.log(
      `  Validation steps:  ${c("green", `${stepsPassed}/${stepsTotal} passed`)}`
    );
  } else {
    console.log(
      `  Validation steps:  ${c("red", `${stepsFailed} failed`)} / ${stepsTotal} total`
    );
  }

  // Topic analysis (only if available)
  if (report.summary.atomicTopics !== undefined) {
    const totalTopics =
      (report.summary.atomicTopics ?? 0) +
      (report.summary.nonAtomicTopics ?? 0) +
      (report.summary.schemaInvalidTopics ?? 0);
    const pct =
      totalTopics > 0
        ? (
            ((report.summary.atomicTopics ?? 0) / totalTopics) *
            100
          ).toFixed(0)
        : "0";

    console.log(
      `  Atomic topics:     ${c("green", String(report.summary.atomicTopics))}/${totalTopics} (${pct}%)`
    );

    if ((report.summary.nonAtomicTopics ?? 0) > 0) {
      console.log(
        `  Non-atomic topics: ${c("red", String(report.summary.nonAtomicTopics))}`
      );
    }

    if ((report.summary.schemaInvalidTopics ?? 0) > 0) {
      console.log(
        `  Schema-invalid:    ${c("red", String(report.summary.schemaInvalidTopics))}`
      );
    }

    if ((report.summary.topicWarnings ?? 0) > 0) {
      console.log(
        `  Topic warnings:    ${c("yellow", String(report.summary.topicWarnings))}`
      );
    }

    if ((report.summary.conflicts ?? 0) > 0) {
      console.log(
        `  Conflicts:         ${c("yellow", String(report.summary.conflicts))}`
      );
    } else {
      console.log(`  Conflicts:         0`);
    }

    // Compact condition x direction
    if (report.topicAnalysis) {
      console.log("");
      console.log(`  ${c("bold", "Condition x Direction:")}`);
      for (const e of report.topicAnalysis.conditionDirectionBreakdown) {
        const dir =
          e.direction === "helps"
            ? c("green", "helps")
            : c("red", "harms");
        console.log(`    ${e.condition} [${dir}]: ${e.count}`);
      }
    }
  }

  console.log("");
  console.log("─".repeat(60));
  const totalBad =
    (report.summary.nonAtomicTopics ?? 0) +
    (report.summary.schemaInvalidTopics ?? 0);
  if (
    stepsFailed === 0 &&
    totalBad === 0 &&
    (report.summary.conflicts ?? 0) === 0
  ) {
    console.log(c("green", "✓ All checks passed. No conflicts."));
  } else {
    if (stepsFailed > 0) {
      console.log(
        c("red", `✗ ${stepsFailed} validation step(s) failed.`)
      );
    }
    if ((report.summary.schemaInvalidTopics ?? 0) > 0) {
      console.log(
        c(
          "red",
          `✗ ${report.summary.schemaInvalidTopics} topic(s) failed schema validation.`
        )
      );
    }
    if ((report.summary.nonAtomicTopics ?? 0) > 0) {
      console.log(
        c(
          "red",
          `✗ ${report.summary.nonAtomicTopics} non-atomic topic(s) need correction.`
        )
      );
    }
    if ((report.summary.conflicts ?? 0) > 0) {
      console.log(
        c(
          "yellow",
          `! ${report.summary.conflicts} topic conflict(s) found.`
        )
      );
    }
  }
  console.log("─".repeat(60));
  console.log("");
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = parseCliArgs();
  const steps: StepResult[] = [];
  let loadedTopics: Topic[] | undefined;
  let rawTopicArray: unknown[] | undefined;

  const topicsPath = resolve(args.topics!);
  const standardsPath = resolve(args.standards!);
  const seoPath = resolve(args.seo!);

  const isJson = !!args.json;
  const isStrict = !!args.strict;
  const isSummary = !!args.summary;
  const isVerbose = !!args.verbose;
  // --summary and --json suppress step-by-step printing
  const printSteps = !isJson && !isSummary;

  if (printSteps) {
    printHeader();
  }

  // Helper: emit a step result and optionally bail under --strict
  function record(step: StepResult): boolean {
    steps.push(step);

    if (printSteps) {
      if (step.success) {
        printSuccess(step.component, step.message);
        if (isVerbose && step.details) {
          step.details.forEach((d) => printDetail(d));
        }
      } else {
        printFailure(step.component, step.message);
        step.details?.forEach((d) => printError(d));
      }
      console.log("");
    }

    if (isStrict && !step.success) {
      finish();
      return false; // signal caller to stop
    }
    return true;
  }

  // Helper: finalize and exit
  function finish(): never {
    const analysis =
      rawTopicArray && rawTopicArray.length > 0
        ? analyzeTopics(rawTopicArray, loadedTopics ?? [])
        : undefined;

    const report = buildReport(steps, analysis);

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else if (isSummary) {
      printSummary(report);
    } else {
      // Already printed step-by-step; just print analysis + footer
      if (analysis) {
        printAtomicityReport(analysis.atomicity, isVerbose);
        printConditionDirectionBreakdown(
          analysis.conditionDirectionBreakdown,
          isVerbose
        );
        printConflicts(analysis.conflicts);
      }
      printFooter(report.summary.stepsPassed, report.summary.stepsFailed);
    }

    process.exit(report.summary.stepsFailed > 0 ? 1 : 0);
  }

  // ---- 1. ResearchConfig ----
  const configStep = runConfigStep();
  if (!record(configStep)) finish();

  const researchConfig = configStep.success
    ? loadResearchConfig(DEFAULT_RESEARCH_CONFIG)
    : null;

  // ---- 2. Topics ----
  if (researchConfig) {
    const { step, topics, rawTopics } = runTopicsStep(topicsPath, researchConfig);
    loadedTopics = topics;
    rawTopicArray = rawTopics;
    if (!record(step)) finish();
  }

  // ---- 3. Content Standards ----
  const stdStep = runContentStandardsStep(standardsPath);
  if (!record(stdStep)) finish();

  // ---- 4. SEO Guidelines ----
  const seoStep = runSeoGuidelinesStep(seoPath);
  if (!record(seoStep)) finish();

  // ---- 5. Specification Assembly ----
  if (researchConfig) {
    const specStep = runSpecAssemblyStep(
      researchConfig,
      topicsPath,
      standardsPath,
      seoPath
    );
    if (!record(specStep)) finish();
  }

  // ---- Done ----
  finish();
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
