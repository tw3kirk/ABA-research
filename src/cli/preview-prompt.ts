#!/usr/bin/env node
/**
 * CLI tool to preview and diff rendered prompts.
 *
 * Loads a topic and template, renders the full prompt (with conditionals,
 * variables, and constraints), and outputs the result to stdout. Optionally
 * saves snapshots and diffs against previous snapshots.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS TOOL EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Running a single topic through Gemini Deep Research is expensive — it
 * costs real money, takes minutes, and produces content that's hard to
 * roll back. Debugging a bad prompt AFTER a research run means wasted
 * budget and wasted time.
 *
 * This tool lets you:
 *
 *   1. PREVIEW the exact prompt that will be sent, before spending API
 *      credits. You can verify that conditionals resolved correctly,
 *      constraints are present, and variables are populated.
 *
 *   2. SNAPSHOT a known-good prompt so you can detect regressions later.
 *      If a template edit, config change, or code change causes the
 *      prompt to shift, the diff will surface it immediately.
 *
 *   3. DIFF two versions of the same prompt to review changes before
 *      committing. This catches subtle issues like dropped constraints,
 *      flipped conditional branches, or missing variables that would
 *      otherwise only show up as lower-quality research output.
 *
 * By catching prompt problems at preview time rather than after an LLM
 * call, you save both money and iteration cycles.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Preview a prompt:
 *   npm run preview-prompt -- --topic dairy_harms_acne --template deep-research.md
 *
 * Save a snapshot:
 *   npm run preview-prompt -- --topic dairy_harms_acne --template deep-research.md --save my-snapshot
 *
 * Diff against a snapshot:
 *   npm run diff-prompt -- --topic dairy_harms_acne --template deep-research.md --against my-snapshot
 *
 * Options:
 *   --topic <topicId>       Topic ID from the topics file
 *   --template <filename>   Template filename in prompts/ directory
 *   --topics <path>         Path to topics JSON (default: topics/sample-topics.json)
 *   --standards <path>      Path to content standards JSON (default: config/content-standards.json)
 *   --seo <path>            Path to SEO guidelines JSON (default: config/seo-guidelines.json)
 *   --prompts <dir>         Path to prompts directory (default: prompts/)
 *   --save <snapshotId>     Save rendered prompt as a named snapshot
 *   --against <snapshotId>  Diff current prompt against a saved snapshot
 *   --no-constraints        Skip constraint injection
 *   --no-color              Disable ANSI colors
 *   --json                  Output as JSON (includes metadata)
 *   -h, --help              Show help
 *
 * Exit codes:
 *   0 - Success (preview or diff with no differences)
 *   1 - Error (invalid topic, template, or missing context)
 *   2 - Diff found differences
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

import {
  loadResearchConfig,
  DEFAULT_RESEARCH_CONFIG,
} from "../config/index.js";
import {
  loadTopics,
  type Topic,
} from "../topics/index.js";
import {
  loadContentStandards,
  loadSeoGuidelines,
} from "../standards/index.js";
import {
  createSpecification,
} from "../specification/index.js";
import { generateRunId } from "../logging/index.js";
import {
  PromptTemplateLoader,
  buildPromptContext,
  renderPrompt,
  buildPromptConstraints,
  computePromptHash,
  computeTemplateVersion,
  createSnapshot,
  storeSnapshot as storeVersionedSnapshot,
  loadSnapshotByHash,
  verifySnapshot,
  listSnapshots as listVersionedSnapshots,
} from "../prompts/index.js";

// ============================================================
// Types
// ============================================================

interface PreviewResult {
  topicId: string;
  templateName: string;
  rendered: string;
  templateSource: string;
  metadata: {
    topicEntity: string;
    topicCondition: string;
    claimDirection: string;
    category: string;
    constraintsIncluded: boolean;
    variableCount: number;
    lineCount: number;
    charCount: number;
  };
}

interface DiffLine {
  type: "added" | "removed" | "context";
  lineNumber: number;
  text: string;
}

interface DiffResult {
  snapshotId: string;
  hasChanges: boolean;
  added: number;
  removed: number;
  unchanged: number;
  lines: DiffLine[];
}

// ============================================================
// CLI Parsing
// ============================================================

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      topic: { type: "string" },
      template: { type: "string" },
      topics: { type: "string", default: "topics/sample-topics.json" },
      standards: { type: "string", default: "config/content-standards.json" },
      seo: { type: "string", default: "config/seo-guidelines.json" },
      prompts: { type: "string", default: "prompts" },
      save: { type: "string" },
      against: { type: "string" },
      store: { type: "boolean", default: false },
      snapshot: { type: "string" },
      "snapshot-dir": { type: "string", default: "snapshots/prompts" },
      "list-snapshots": { type: "boolean", default: false },
      "no-constraints": { type: "boolean", default: false },
      "no-color": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(`
Usage: preview-prompt [options]
       diff-prompt [options]

Preview mode (default):
  npm run preview-prompt -- --topic <topicId> --template <filename>

Diff mode:
  npm run diff-prompt -- --topic <topicId> --template <filename> --against <snapshotId>

Snapshot mode:
  npm run preview-prompt -- --topic <topicId> --template <filename> --store
  npm run preview-prompt -- --snapshot <hash> --topic <topicId> --template <filename>
  npm run preview-prompt -- --list-snapshots --topic <topicId> --template <filename>

Options:
  --topic <topicId>       Topic ID from the topics file (required)
  --template <filename>   Template filename in prompts/ directory (required)
  --topics <path>         Path to topics JSON (default: topics/sample-topics.json)
  --standards <path>      Path to content standards JSON (default: config/content-standards.json)
  --seo <path>            Path to SEO guidelines JSON (default: config/seo-guidelines.json)
  --prompts <dir>         Path to prompts directory (default: prompts/)
  --save <snapshotId>     Save rendered prompt as a named diff snapshot
  --against <snapshotId>  Diff current prompt against a saved diff snapshot
  --store                 Store rendered prompt as a versioned snapshot (content-addressed)
  --snapshot <hash>       Load and display an existing versioned snapshot by hash
  --snapshot-dir <dir>    Base directory for versioned snapshots (default: snapshots/prompts)
  --list-snapshots        List all versioned snapshot hashes for the topic/template pair
  --no-constraints        Skip constraint injection
  --no-color              Disable ANSI colors
  --json                  Output as JSON (includes metadata)
  -h, --help              Show this help message

Exit codes:
  0 - Success (preview or diff with no differences)
  1 - Error (invalid topic, template, or missing context)
  2 - Diff found differences
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
  magenta: "\x1b[35m",
};

let useColors = process.stdout.isTTY && !process.env.NO_COLOR;

function c(color: keyof typeof COLORS, text: string): string {
  return useColors ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

// ============================================================
// Snapshot Management
// ============================================================

/** Directory where prompt snapshots are stored. */
const SNAPSHOT_DIR = "output/prompt-snapshots";

/**
 * Get the filesystem path for a snapshot.
 */
function snapshotPath(snapshotId: string, topicId: string, templateName: string): string {
  const safeName = `${snapshotId}--${topicId}--${templateName.replace(/\.[^.]+$/, "")}.txt`;
  return resolve(join(SNAPSHOT_DIR, safeName));
}

/**
 * Save a rendered prompt as a named snapshot.
 */
function saveSnapshot(
  snapshotId: string,
  topicId: string,
  templateName: string,
  rendered: string
): string {
  const dir = resolve(SNAPSHOT_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = snapshotPath(snapshotId, topicId, templateName);
  writeFileSync(filePath, rendered, "utf-8");
  return filePath;
}

/**
 * Load a previously saved snapshot.
 */
function loadSnapshot(
  snapshotId: string,
  topicId: string,
  templateName: string
): string {
  const filePath = snapshotPath(snapshotId, topicId, templateName);

  if (!existsSync(filePath)) {
    throw new Error(
      `Snapshot not found: ${filePath}\n` +
      `Save a snapshot first with: --save ${snapshotId}`
    );
  }

  return readFileSync(filePath, "utf-8");
}

// ============================================================
// Diff Engine
// ============================================================

/**
 * Normalize non-deterministic fields in rendered prompts.
 *
 * Replaces values that change on every render (runId, startedAt) with
 * stable placeholders so that diffs focus on meaningful changes rather
 * than per-run metadata noise.
 */
export function normalizeForDiff(text: string): string {
  // Run IDs: "20240115-a1b2c3" pattern
  let normalized = text.replace(/\b\d{8}-[0-9a-f]{6}\b/g, "<RUN_ID>");
  // ISO timestamps: "2024-01-15T12:30:00.000Z" or similar
  normalized = normalized.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, "<TIMESTAMP>");
  return normalized;
}

/**
 * Compute a line-level diff between two strings.
 *
 * Uses a simple longest-common-subsequence (LCS) algorithm.
 * Whitespace-only changes are treated as unchanged.
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesEqual(oldLines[i - 1]!, newLines[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to produce diff
  const lines: DiffLine[] = [];
  let i = m;
  let j = n;

  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesEqual(oldLines[i - 1]!, newLines[j - 1]!)) {
      stack.push({ type: "context", lineNumber: j, text: newLines[j - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      stack.push({ type: "added", lineNumber: j, text: newLines[j - 1]! });
      j--;
    } else {
      stack.push({ type: "removed", lineNumber: i, text: oldLines[i - 1]! });
      i--;
    }
  }

  // Reverse to get correct order
  while (stack.length > 0) {
    lines.push(stack.pop()!);
  }

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const line of lines) {
    if (line.type === "added") added++;
    else if (line.type === "removed") removed++;
    else unchanged++;
  }

  return {
    snapshotId: "",
    hasChanges: added > 0 || removed > 0,
    added,
    removed,
    unchanged,
    lines,
  };
}

/**
 * Compare two lines, ignoring whitespace-only differences.
 */
function linesEqual(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd();
}

/**
 * Format a diff result for terminal output.
 */
function formatDiff(diff: DiffResult, contextLines: number = 3): string {
  const output: string[] = [];

  if (!diff.hasChanges) {
    output.push(c("green", "No differences found."));
    return output.join("\n");
  }

  output.push(c("bold", `─── Diff against snapshot: ${diff.snapshotId} ───`));
  output.push(
    c("red", `  - ${diff.removed} removed`) + "  " +
    c("green", `+ ${diff.added} added`) + "  " +
    c("dim", `${diff.unchanged} unchanged`)
  );
  output.push("");

  // Show changes with surrounding context
  const changeIndexes = new Set<number>();
  for (let i = 0; i < diff.lines.length; i++) {
    if (diff.lines[i]!.type !== "context") {
      for (let ctx = Math.max(0, i - contextLines); ctx <= Math.min(diff.lines.length - 1, i + contextLines); ctx++) {
        changeIndexes.add(ctx);
      }
    }
  }

  let lastShown = -1;
  for (let i = 0; i < diff.lines.length; i++) {
    if (!changeIndexes.has(i)) continue;

    // Show gap marker
    if (lastShown !== -1 && i > lastShown + 1) {
      output.push(c("dim", "  ..."));
    }
    lastShown = i;

    const line = diff.lines[i]!;
    switch (line.type) {
      case "added":
        output.push(c("green", `+ ${line.text}`));
        break;
      case "removed":
        output.push(c("red", `- ${line.text}`));
        break;
      case "context":
        output.push(c("dim", `  ${line.text}`));
        break;
    }
  }

  return output.join("\n");
}

// ============================================================
// Preview Logic
// ============================================================

/**
 * Load all required data and render a prompt for a given topic.
 */
function renderPreview(options: {
  topicId: string;
  templateName: string;
  topicsPath: string;
  standardsPath: string;
  seoPath: string;
  promptsDir: string;
  includeConstraints: boolean;
}): PreviewResult {
  const {
    topicId, templateName, topicsPath, standardsPath, seoPath,
    promptsDir, includeConstraints,
  } = options;

  // 1. Load config
  const config = loadResearchConfig(DEFAULT_RESEARCH_CONFIG);

  // 2. Load topics and find the requested one
  const topicsFullPath = resolve(topicsPath);
  if (!existsSync(topicsFullPath)) {
    throw new Error(`Topics file not found: ${topicsFullPath}`);
  }
  const topicsData = JSON.parse(readFileSync(topicsFullPath, "utf-8"));
  const result = loadTopics(topicsData, config, { atomicityMode: "strict" });

  if (!result.success || !result.topics) {
    const errors = result.errors?.map((e) => `  - [${e.topicId ?? "?"}] ${e.message}`).join("\n") ?? "";
    throw new Error(`Topic loading failed:\n${errors}`);
  }

  const topic = result.topics.find((t: Topic) => t.id === topicId);
  if (!topic) {
    const available = result.topics.map((t: Topic) => t.id).sort().join(", ");
    throw new Error(
      `Topic "${topicId}" not found.\nAvailable topics: ${available}`
    );
  }

  // 3. Load template
  const loader = new PromptTemplateLoader(resolve(promptsDir));
  const template = loader.load(templateName);

  // 4. Load standards (optional — don't fail if not found)
  let contentStandards;
  let seoGuidelines;

  const stdPath = resolve(standardsPath);
  if (existsSync(stdPath)) {
    const stdData = JSON.parse(readFileSync(stdPath, "utf-8"));
    contentStandards = loadContentStandards(stdData);
  }

  const seoFullPath = resolve(seoPath);
  if (existsSync(seoFullPath)) {
    const seoData = JSON.parse(readFileSync(seoFullPath, "utf-8"));
    seoGuidelines = loadSeoGuidelines(seoData);
  }

  // 5. Build specification
  const specification = createSpecification({
    runId: generateRunId(),
    researchConfig: config,
    topics: result.topics,
    contentStandards,
    seoGuidelines,
    captureGit: false,
  });

  // 6. Build context
  const context = buildPromptContext({
    topic,
    specification,
    contentStandards,
    seoGuidelines,
  });

  // 7. Build constraints (optional)
  const constraints = includeConstraints
    ? buildPromptConstraints({ topic, specification, contentStandards })
    : undefined;

  // 8. Render
  const rendered = renderPrompt(template, context, {
    strict: false,
    constraints,
  });

  return {
    topicId: topic.id,
    templateName,
    rendered,
    templateSource: template.source,
    metadata: {
      topicEntity: topic.primaryEntity,
      topicCondition: topic.condition,
      claimDirection: topic.claim.direction,
      category: topic.category,
      constraintsIncluded: includeConstraints,
      variableCount: template.variables.length,
      lineCount: rendered.split("\n").length,
      charCount: rendered.length,
    },
  };
}

// ============================================================
// Output Formatting
// ============================================================

function printPreviewHeader(result: PreviewResult): void {
  console.log("");
  console.log(c("bold", "═".repeat(60)));
  console.log(c("bold", " Prompt Preview"));
  console.log(c("bold", "═".repeat(60)));
  console.log("");
  console.log(`  ${c("cyan", "Topic:")}      ${result.topicId}`);
  console.log(`  ${c("cyan", "Entity:")}     ${result.metadata.topicEntity}`);
  console.log(`  ${c("cyan", "Condition:")}  ${result.metadata.topicCondition}`);
  console.log(`  ${c("cyan", "Direction:")}  ${result.metadata.claimDirection}`);
  console.log(`  ${c("cyan", "Category:")}   ${result.metadata.category}`);
  console.log(`  ${c("cyan", "Template:")}   ${result.templateName}`);
  console.log(`  ${c("cyan", "Lines:")}      ${result.metadata.lineCount}`);
  console.log(`  ${c("cyan", "Characters:")} ${result.metadata.charCount}`);
  console.log(`  ${c("cyan", "Variables:")}  ${result.metadata.variableCount}`);
  console.log(`  ${c("cyan", "Constraints:")} ${result.metadata.constraintsIncluded ? "yes" : "no"}`);
  console.log(`  ${c("cyan", "Hash:")}        ${computePromptHash(result.rendered)}`);
  console.log("");
  console.log("─".repeat(60));
  console.log("");
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  const args = parseCliArgs();

  // Respect --no-color
  if (args["no-color"]) {
    useColors = false;
  }

  // Validate required arguments
  if (!args.topic) {
    console.error(c("red", "Error: --topic is required"));
    console.error("  Usage: npm run preview-prompt -- --topic <topicId> --template <templateName>");
    process.exit(1);
  }

  if (!args.template) {
    console.error(c("red", "Error: --template is required"));
    console.error("  Usage: npm run preview-prompt -- --topic <topicId> --template <templateName>");
    process.exit(1);
  }

  const snapshotDir = args["snapshot-dir"]!;

  // Handle --list-snapshots (no render needed)
  if (args["list-snapshots"]) {
    const hashes = listVersionedSnapshots(args.template, args.topic, snapshotDir);
    if (args.json) {
      console.log(JSON.stringify({
        mode: "list-snapshots",
        topic: args.topic,
        template: args.template,
        hashes,
        count: hashes.length,
      }, null, 2));
    } else if (hashes.length === 0) {
      console.log(c("dim", "No snapshots found."));
    } else {
      console.log(c("bold", `Snapshots for ${args.topic} / ${args.template}:`));
      for (const hash of hashes) {
        console.log(`  ${hash}`);
      }
      console.log(c("dim", `\n  ${hashes.length} snapshot(s)`));
    }
    process.exit(0);
    return;
  }

  // Handle --snapshot <hash> (load existing snapshot, no render needed)
  if (args.snapshot) {
    const result = loadSnapshotByHash(args.snapshot, args.template, args.topic, snapshotDir);
    if (!result.success) {
      console.error(c("red", `Error: ${result.error}`));
      process.exit(1);
    }

    const snap = result.snapshot!;
    const verification = verifySnapshot(snap);

    if (args.json) {
      console.log(JSON.stringify({
        mode: "snapshot",
        hash: snap.hash,
        verified: verification.valid,
        metadata: snap.metadata,
        rendered: snap.renderedText,
      }, null, 2));
    } else {
      console.log("");
      console.log(c("bold", "═".repeat(60)));
      console.log(c("bold", " Snapshot Viewer"));
      console.log(c("bold", "═".repeat(60)));
      console.log("");
      console.log(`  ${c("cyan", "Hash:")}             ${snap.hash}`);
      console.log(`  ${c("cyan", "Integrity:")}        ${verification.valid ? c("green", "verified") : c("red", "FAILED")}`);
      console.log(`  ${c("cyan", "Topic:")}            ${snap.metadata.topicId}`);
      console.log(`  ${c("cyan", "Template:")}         ${snap.metadata.templateName}`);
      console.log(`  ${c("cyan", "Template version:")} ${snap.metadata.templateVersion}`);
      console.log(`  ${c("cyan", "Git commit:")}       ${snap.metadata.gitCommit}`);
      console.log(`  ${c("cyan", "Git branch:")}       ${snap.metadata.gitBranch}`);
      console.log(`  ${c("cyan", "Created:")}          ${snap.metadata.createdAt}`);
      console.log("");
      console.log("─".repeat(60));
      console.log("");
      console.log(snap.renderedText);
    }

    process.exit(verification.valid ? 0 : 1);
    return;
  }

  // Render the prompt
  const preview = renderPreview({
    topicId: args.topic,
    templateName: args.template,
    topicsPath: args.topics!,
    standardsPath: args.standards!,
    seoPath: args.seo!,
    promptsDir: args.prompts!,
    includeConstraints: !args["no-constraints"],
  });

  // Handle --store (versioned content-addressed snapshot)
  if (args.store) {
    let gitCommit = "unknown";
    let gitBranch = "unknown";
    try {
      const { execSync } = await import("node:child_process");
      gitCommit = execSync("git rev-parse HEAD", { stdio: "pipe" }).toString().trim();
      gitBranch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" }).toString().trim();
    } catch {
      // Not in a git repo — use defaults
    }

    const templateVersion = computeTemplateVersion(preview.templateSource);
    const snapshot = createSnapshot({
      renderedText: preview.rendered,
      templateName: preview.templateName,
      templateVersion,
      topicId: preview.topicId,
      gitCommit,
      gitBranch,
    });

    const filePath = storeVersionedSnapshot(snapshot, snapshotDir);
    const hash = snapshot.hash;

    if (args.json) {
      console.log(JSON.stringify({
        mode: "store",
        hash,
        path: filePath,
        metadata: snapshot.metadata,
      }, null, 2));
      process.exit(0);
      return;
    }

    console.error(c("green", `Versioned snapshot stored: ${hash}`));
    console.error(c("dim", `  Path: ${filePath}`));
  }

  // Handle --save
  if (args.save) {
    const filePath = saveSnapshot(args.save, args.topic, args.template, preview.rendered);
    if (!args.json) {
      console.error(c("green", `Snapshot saved: ${filePath}`));
    }
  }

  // Handle --against (diff mode)
  if (args.against) {
    const snapshotText = loadSnapshot(args.against, args.topic, args.template);
    // Normalize non-deterministic fields (runId, timestamps) so diffs
    // focus on meaningful structural changes, not per-run metadata noise.
    const diff = computeDiff(
      normalizeForDiff(snapshotText),
      normalizeForDiff(preview.rendered)
    );
    diff.snapshotId = args.against;

    if (args.json) {
      console.log(JSON.stringify({
        mode: "diff",
        topic: args.topic,
        template: args.template,
        snapshot: args.against,
        ...diff,
      }, null, 2));
    } else {
      printPreviewHeader(preview);
      console.log(formatDiff(diff));
      console.log("");
    }

    process.exit(diff.hasChanges ? 2 : 0);
    return;
  }

  // Preview mode (default)
  if (args.json) {
    console.log(JSON.stringify({
      mode: "preview",
      ...preview,
    }, null, 2));
  } else {
    printPreviewHeader(preview);
    console.log(preview.rendered);
  }

  process.exit(0);
}

// Only run when executed directly (not imported by tests)
const isDirectExecution = process.argv[1] &&
  (process.argv[1].endsWith("preview-prompt.ts") ||
   process.argv[1].endsWith("preview-prompt.js"));

if (isDirectExecution) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(c("red", `Error: ${message}`));
    process.exit(1);
  });
}
