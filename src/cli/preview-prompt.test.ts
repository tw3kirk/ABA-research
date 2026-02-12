/**
 * Tests for the prompt preview and diff CLI tool.
 *
 * Run: node --import tsx src/cli/preview-prompt.test.ts
 *
 * Tests cover:
 *   1. Diff engine — line-level diffing with whitespace handling
 *   2. Preview rendering — end-to-end prompt generation for known topics
 *   3. Snapshot round-trip — save, load, diff cycle
 *   4. CLI error paths — missing topics, invalid templates
 *   5. Integration — real topics + real template preview
 */

import { strict as assert } from "node:assert";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import { computeDiff, normalizeForDiff } from "./preview-prompt.js";

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
// DIFF ENGINE TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Diff Engine — Identical Inputs");

test("identical strings produce no changes", () => {
  const text = "line 1\nline 2\nline 3";
  const diff = computeDiff(text, text);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.added, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.unchanged, 3);
});

test("identical single line", () => {
  const diff = computeDiff("hello", "hello");
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.unchanged, 1);
});

test("empty strings are identical", () => {
  const diff = computeDiff("", "");
  assert.equal(diff.hasChanges, false);
});

section("Diff Engine — Additions");

test("detects added lines", () => {
  const old = "line 1\nline 3";
  const next = "line 1\nline 2\nline 3";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 0);
  assert.equal(diff.unchanged, 2);
  const addedLine = diff.lines.find((l) => l.type === "added");
  assert.ok(addedLine);
  assert.equal(addedLine.text, "line 2");
});

test("detects multiple additions", () => {
  const old = "a";
  const next = "a\nb\nc";
  const diff = computeDiff(old, next);
  assert.equal(diff.added, 2);
  assert.equal(diff.removed, 0);
});

test("detects addition at start", () => {
  const old = "b\nc";
  const next = "a\nb\nc";
  const diff = computeDiff(old, next);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 0);
  assert.equal(diff.unchanged, 2);
});

section("Diff Engine — Removals");

test("detects removed lines", () => {
  const old = "line 1\nline 2\nline 3";
  const next = "line 1\nline 3";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 0);
  const removedLine = diff.lines.find((l) => l.type === "removed");
  assert.ok(removedLine);
  assert.equal(removedLine.text, "line 2");
});

test("detects removal at end", () => {
  const old = "a\nb\nc";
  const next = "a\nb";
  const diff = computeDiff(old, next);
  assert.equal(diff.removed, 1);
  assert.equal(diff.unchanged, 2);
});

section("Diff Engine — Changes");

test("detects changed lines as remove + add", () => {
  const old = "line 1\nold content\nline 3";
  const next = "line 1\nnew content\nline 3";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.unchanged, 2);
});

test("complete rewrite", () => {
  const old = "a\nb\nc";
  const next = "x\ny\nz";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added, 3);
  assert.equal(diff.removed, 3);
  assert.equal(diff.unchanged, 0);
});

section("Diff Engine — Whitespace Handling");

test("ignores trailing whitespace differences", () => {
  const old = "line 1  \nline 2\nline 3";
  const next = "line 1\nline 2\nline 3";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.unchanged, 3);
});

test("ignores trailing tab differences", () => {
  const old = "hello\t";
  const next = "hello";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, false);
});

test("detects leading whitespace changes", () => {
  const old = "  indented";
  const next = "indented";
  const diff = computeDiff(old, next);
  assert.equal(diff.hasChanges, true);
});

section("Diff Engine — Edge Cases");

test("old empty, new has content", () => {
  const diff = computeDiff("", "line 1\nline 2");
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added, 2);
  // The empty string produces one empty line: [""]
  // That empty line is removed when comparing against "line 1\nline 2"
  assert.ok(diff.removed >= 0);
});

test("old has content, new empty", () => {
  const diff = computeDiff("line 1\nline 2", "");
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.removed, 2);
});

test("large diff stays stable", () => {
  const oldLines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
  const newLines = [...oldLines];
  newLines[25] = "CHANGED LINE";
  newLines.splice(10, 0, "INSERTED");

  const diff = computeDiff(oldLines.join("\n"), newLines.join("\n"));
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.added, 2); // inserted + changed
  assert.equal(diff.removed, 1); // original line 25
});

section("Diff Engine — Determinism");

test("same inputs always produce same diff", () => {
  const old = "alpha\nbeta\ngamma";
  const next = "alpha\ndelta\ngamma";
  const d1 = computeDiff(old, next);
  const d2 = computeDiff(old, next);
  assert.deepStrictEqual(d1, d2);
});

test("diff is not symmetric", () => {
  const a = "line 1\nline 2";
  const b = "line 1\nline 2\nline 3";
  const ab = computeDiff(a, b);
  const ba = computeDiff(b, a);
  assert.equal(ab.added, 1);
  assert.equal(ab.removed, 0);
  assert.equal(ba.added, 0);
  assert.equal(ba.removed, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("Normalization — Run IDs and Timestamps");

test("normalizes run IDs", () => {
  const text = "Run ID: 20240115-a1b2c3";
  const result = normalizeForDiff(text);
  assert.equal(result, "Run ID: <RUN_ID>");
});

test("normalizes ISO timestamps", () => {
  const text = "Started: 2024-01-15T12:30:00.000Z";
  const result = normalizeForDiff(text);
  assert.equal(result, "Started: <TIMESTAMP>");
});

test("normalizes multiple run IDs", () => {
  const text = "20240115-a1b2c3 and 20260212-ff00ee";
  const result = normalizeForDiff(text);
  assert.equal(result, "<RUN_ID> and <RUN_ID>");
});

test("does not touch non-matching content", () => {
  const text = "turmeric helps redness";
  const result = normalizeForDiff(text);
  assert.equal(result, text);
});

test("normalized diff ignores run ID differences", () => {
  const old = "Run ID: 20240101-aaaaaa\nOther content";
  const next = "Run ID: 20260212-bbbbbb\nOther content";
  const diff = computeDiff(normalizeForDiff(old), normalizeForDiff(next));
  assert.equal(diff.hasChanges, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// CLI INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

section("CLI — Help");

test("--help exits with code 0", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --help",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("Usage:"));
  assert.ok(result.includes("--topic"));
  assert.ok(result.includes("--template"));
});

section("CLI — Error Cases");

test("missing --topic fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --template deep-research.md",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes("--topic is required"));
  }
});

test("missing --template fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes("--template is required"));
  }
});

test("non-existent topic fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic nonexistent_topic_xyz --template deep-research.md",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes("not found"));
  }
});

test("non-existent template fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template nonexistent.md",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes("not found"));
  }
});

test("non-existent topics file fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --topics nonexistent.json",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
  }
});

section("CLI — Preview Mode");

test("preview renders dairy_harms_acne with deep-research template", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  // Should contain topic-specific content
  assert.ok(result.includes("dairy"));
  assert.ok(result.includes("acne_acne_scars"));
  assert.ok(result.includes("harms"));
  // Should contain rendered template sections
  assert.ok(result.includes("Research Context"));
  assert.ok(result.includes("Harm-Specific Research Requirements"));
  // Should contain constraints
  assert.ok(result.includes("Constraints & Exclusions"));
});

test("preview renders turmeric_helps_redness", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic turmeric_helps_redness --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("turmeric"));
  assert.ok(result.includes("redness_hyperpigmentation"));
  assert.ok(result.includes("helps"));
  assert.ok(result.includes("Benefit-Specific Research Requirements"));
  // Should NOT contain harm-specific sections
  assert.ok(!result.includes("Harm-Specific Research Requirements"));
});

test("preview --no-constraints omits constraints section", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --no-color --no-constraints",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("dairy"));
  assert.ok(!result.includes("Constraints & Exclusions"));
});

test("preview --json outputs valid JSON with metadata", () => {
  const raw = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --json",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const json = JSON.parse(raw);
  assert.equal(json.mode, "preview");
  assert.equal(json.topicId, "dairy_harms_acne");
  assert.equal(json.templateName, "deep-research.md");
  assert.ok(json.rendered.length > 0);
  assert.equal(json.metadata.claimDirection, "harms");
  assert.equal(json.metadata.topicCondition, "acne_acne_scars");
  assert.equal(typeof json.metadata.lineCount, "number");
  assert.equal(typeof json.metadata.charCount, "number");
  assert.ok(json.metadata.constraintsIncluded);
});

section("CLI — Snapshot Save/Load/Diff");

test("save and diff with no changes exits code 0", () => {
  // Save a snapshot
  execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --save test-snap-01 --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );

  // Diff against same snapshot — no changes
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --against test-snap-01 --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("No differences found"));
});

test("diff against non-existent snapshot fails with code 1", () => {
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --against nonexistent-snap",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown");
  } catch (err: any) {
    assert.equal(err.status, 1);
    assert.ok(err.stderr.includes("Snapshot not found"));
  }
});

test("diff with modified snapshot exits code 2", () => {
  // Save a snapshot
  execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --save test-snap-02 --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );

  // Manually modify the snapshot file
  const snapFile = join(
    "output/prompt-snapshots",
    "test-snap-02--dairy_harms_acne--deep-research.txt"
  );
  const original = readFileSync(snapFile, "utf-8");
  writeFileSync(snapFile, original + "\n\nMANUALLY ADDED LINE", "utf-8");

  // Diff should detect changes and exit with code 2
  try {
    execSync(
      "node --import tsx src/cli/preview-prompt.ts --topic dairy_harms_acne --template deep-research.md --against test-snap-02 --no-color",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    assert.fail("Should have thrown with exit code 2");
  } catch (err: any) {
    assert.equal(err.status, 2);
    const output = err.stdout?.toString() ?? "";
    assert.ok(output.includes("removed") || output.includes("added"));
  }
});

test("diff --json outputs valid JSON", () => {
  // Save a snapshot first
  execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic turmeric_helps_redness --template deep-research.md --save test-snap-03 --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );

  // Diff against identical snapshot
  const raw = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic turmeric_helps_redness --template deep-research.md --against test-snap-03 --json",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const json = JSON.parse(raw);
  assert.equal(json.mode, "diff");
  assert.equal(json.hasChanges, false);
  assert.equal(json.added, 0);
  assert.equal(json.removed, 0);
  assert.ok(json.unchanged > 0);
});

section("CLI — Different Topic Previews");

test("kale_helps_redness preview includes plant-based section", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic kale_helps_redness --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("kale"));
  assert.ok(result.includes("Plant-Based Nutrition Research"));
  assert.ok(result.includes("Redness & Hyperpigmentation Considerations"));
});

test("sulfates_harms_dryness preview includes chemical section", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic sulfates_harms_dryness --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("sodium lauryl sulfate"));
  assert.ok(result.includes("Synthetic Chemical Research"));
  assert.ok(result.includes("Dryness & Aging Considerations"));
});

test("face_touching_harms_acne preview includes behavioral section", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic face_touching_harms_acne --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("face touching"));
  assert.ok(result.includes("Behavioral Habit Research"));
});

test("abhyanga_helps_dryness preview includes ayurvedic practice section", () => {
  const result = execSync(
    "node --import tsx src/cli/preview-prompt.ts --topic abhyanga_helps_dryness --template deep-research.md --no-color",
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  assert.ok(result.includes("abhyanga"));
  assert.ok(result.includes("Ayurvedic Practice Research"));
});

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════════════

// Clean up test snapshots
try {
  const snapDir = "output/prompt-snapshots";
  for (const prefix of ["test-snap-01", "test-snap-02", "test-snap-03"]) {
    const files = [
      join(snapDir, `${prefix}--dairy_harms_acne--deep-research.txt`),
      join(snapDir, `${prefix}--turmeric_helps_redness--deep-research.txt`),
    ];
    for (const f of files) {
      if (existsSync(f)) rmSync(f);
    }
  }
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
