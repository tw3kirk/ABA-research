/**
 * Prompt snapshot versioning.
 *
 * Provides content-addressed storage for rendered prompts. Every rendered
 * prompt gets a deterministic SHA-256 hash derived from the full rendered
 * text. Snapshots are stored on disk with metadata that enables integrity
 * verification, audit trails, and exact reproducibility.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY CONTENT-ADDRESSED SNAPSHOTS MATTER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Research pipelines that feed prompts to expensive LLMs (Gemini Deep
 * Research, GPT-4, etc.) have a fundamental trust problem: how do you
 * know that the output you're reading was produced by the prompt you
 * think it was produced by?
 *
 * Content-addressed snapshots solve this in three ways:
 *
 *   1. REPRODUCIBILITY — Given a snapshot hash, you can reconstruct the
 *      exact prompt that produced a research result. If two runs produce
 *      the same hash, you know they used the same prompt — byte for byte.
 *      This is critical when debugging why Run A produced good output and
 *      Run B didn't: if they share the same prompt hash, the problem is
 *      in the LLM's non-determinism, not in your pipeline.
 *
 *   2. AUDITING — Each snapshot records who created it, what git commit
 *      the codebase was at, and which template version was used. An
 *      auditor can trace from a published blog post → research result →
 *      prompt snapshot → exact code state, establishing a full chain of
 *      custody for the research claim.
 *
 *   3. LONG-TERM TRUST — Over months, templates evolve, configs change,
 *      and standards get updated. Without snapshots, you can't prove
 *      that a 6-month-old research result was produced by a rigorous
 *      prompt. With snapshots, the hash in the research output file
 *      points to the immutable snapshot, and the integrity check proves
 *      the prompt hasn't been tampered with after the fact.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DETERMINISM GUARANTEE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The hash is computed from the rendered prompt text only — not from
 * timestamps, run IDs, or other per-execution metadata. This means:
 *
 *   - Same topic + same template + same config = same hash, always
 *   - Changing ANY config value (e.g., minCitationsPerClaim 2→3) changes
 *     the rendered text, which changes the hash
 *   - Changing a conditional branch (e.g., new category block in template)
 *     changes the rendered text for affected topics, producing new hashes
 *   - Changing constraint generation logic changes the appended constraint
 *     block, which changes the hash
 *
 * The metadata (git commit, timestamp, template version) is stored
 * alongside the hash but does NOT affect it. This separation means the
 * hash is purely a content fingerprint, while the metadata provides
 * provenance context.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * STORAGE LAYOUT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   snapshots/prompts/<template>/<topicId>/<hash>.md
 *
 * Example:
 *   snapshots/prompts/deep-research/dairy_harms_acne/a1b2c3d4e5f6.md
 *
 * The .md file contains:
 *   - YAML front matter with metadata (template, topic, hash, git, etc.)
 *   - Separator line (---)
 *   - Full rendered prompt text
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * API OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   computePromptHash(rendered)      — SHA-256 of rendered text → 12-char hex
 *   createSnapshot(options)          — build PromptSnapshot from rendered text
 *   storeSnapshot(snapshot, baseDir) — write snapshot to disk
 *   loadSnapshot(hash, template, topicId, baseDir) — read from disk
 *   verifySnapshot(snapshot)         — recompute hash and compare
 *   getSnapshotPath(template, topicId, hash, baseDir) — resolve path
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata stored alongside a prompt snapshot.
 *
 * None of these fields affect the hash — the hash is derived purely
 * from `renderedText`. Metadata provides provenance for auditing.
 */
export interface SnapshotMetadata {
  /** Template filename that produced this prompt (e.g. "deep-research.md"). */
  templateName: string;

  /** Template version — currently the SHA-256 of the raw template source. */
  templateVersion: string;

  /** Topic ID this prompt was rendered for. */
  topicId: string;

  /** Git commit hash at time of snapshot creation. */
  gitCommit: string;

  /** Git branch at time of snapshot creation. */
  gitBranch: string;

  /** ISO 8601 timestamp of snapshot creation. */
  createdAt: string;
}

/**
 * A complete prompt snapshot: content + metadata + integrity hash.
 */
export interface PromptSnapshot {
  /** SHA-256 content hash (first 12 hex characters). */
  hash: string;

  /** Full rendered prompt text (the content that was hashed). */
  renderedText: string;

  /** Provenance metadata. */
  metadata: Readonly<SnapshotMetadata>;
}

/**
 * Input for creating a snapshot.
 */
export interface CreateSnapshotInput {
  /** The fully rendered prompt text (after conditionals + vars + constraints). */
  renderedText: string;

  /** Template filename. */
  templateName: string;

  /** SHA-256 hash of the raw template source (before variable substitution). */
  templateVersion: string;

  /** Topic ID this prompt was rendered for. */
  topicId: string;

  /** Git commit SHA (or "unknown" if not in a git repo). */
  gitCommit?: string;

  /** Git branch name (or "unknown"). */
  gitBranch?: string;

  /** Override creation timestamp (for testing). */
  createdAt?: string;
}

/**
 * Result of loading a snapshot from disk.
 */
export interface SnapshotLoadResult {
  /** Whether the snapshot was found and loaded successfully. */
  success: boolean;

  /** The loaded snapshot (if success is true). */
  snapshot?: PromptSnapshot;

  /** Error message (if success is false). */
  error?: string;
}

/**
 * Result of verifying a snapshot's integrity.
 */
export interface SnapshotVerifyResult {
  /** Whether the hash matches the content. */
  valid: boolean;

  /** The stored hash. */
  storedHash: string;

  /** The recomputed hash from the rendered text. */
  computedHash: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of hex characters to use from the SHA-256 digest. */
const HASH_LENGTH = 12;

/** Default base directory for prompt snapshots. */
const DEFAULT_BASE_DIR = "snapshots/prompts";

/** Separator between metadata block and prompt text in stored files. */
const METADATA_SEPARATOR = "---";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic content hash for a rendered prompt.
 *
 * Uses SHA-256 truncated to 12 hex characters (48 bits). This provides
 * sufficient collision resistance for the expected corpus size (thousands
 * of prompts, not billions) while keeping hashes readable in filenames,
 * logs, and audit records.
 *
 * DETERMINISM: Same input string always produces the same hash. The hash
 * covers the FULL rendered text including constraint blocks, resolved
 * conditionals, and substituted variables.
 *
 * @param renderedText - The complete rendered prompt text
 * @returns 12-character lowercase hex hash
 */
export function computePromptHash(renderedText: string): string {
  return createHash("sha256")
    .update(renderedText, "utf-8")
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Create a prompt snapshot from a rendered prompt and its provenance data.
 *
 * The hash is computed from `renderedText` only — metadata fields do NOT
 * affect the hash. This guarantees that identical prompts always produce
 * identical hashes regardless of when or where they were created.
 *
 * @param input - Rendered text and provenance data
 * @returns A frozen PromptSnapshot
 */
export function createSnapshot(input: CreateSnapshotInput): Readonly<PromptSnapshot> {
  const hash = computePromptHash(input.renderedText);

  const metadata: SnapshotMetadata = {
    templateName: input.templateName,
    templateVersion: input.templateVersion,
    topicId: input.topicId,
    gitCommit: input.gitCommit ?? "unknown",
    gitBranch: input.gitBranch ?? "unknown",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  const snapshot: PromptSnapshot = {
    hash,
    renderedText: input.renderedText,
    metadata: Object.freeze(metadata),
  };

  return Object.freeze(snapshot);
}

// ---------------------------------------------------------------------------
// Template version hashing
// ---------------------------------------------------------------------------

/**
 * Compute a version identifier for a template's raw source.
 *
 * This is separate from the prompt hash — it identifies the template
 * itself (before variable substitution), so you can tell whether two
 * prompts were produced by the same template version even if different
 * topics changed the final output.
 *
 * @param templateSource - Raw template source text
 * @returns 12-character lowercase hex hash of the template
 */
export function computeTemplateVersion(templateSource: string): string {
  return createHash("sha256")
    .update(templateSource, "utf-8")
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a snapshot to its on-disk format.
 *
 * Format:
 *   hash: <hash>
 *   templateName: <name>
 *   templateVersion: <version>
 *   topicId: <id>
 *   gitCommit: <sha>
 *   gitBranch: <branch>
 *   createdAt: <iso8601>
 *   ---
 *   <rendered prompt text>
 */
function serializeSnapshot(snapshot: PromptSnapshot): string {
  const lines: string[] = [
    `hash: ${snapshot.hash}`,
    `templateName: ${snapshot.metadata.templateName}`,
    `templateVersion: ${snapshot.metadata.templateVersion}`,
    `topicId: ${snapshot.metadata.topicId}`,
    `gitCommit: ${snapshot.metadata.gitCommit}`,
    `gitBranch: ${snapshot.metadata.gitBranch}`,
    `createdAt: ${snapshot.metadata.createdAt}`,
    METADATA_SEPARATOR,
    snapshot.renderedText,
  ];
  return lines.join("\n");
}

/**
 * Deserialize a snapshot from its on-disk format.
 *
 * @param fileContent - The raw file content
 * @returns Parsed PromptSnapshot
 * @throws Error if the format is invalid
 */
function deserializeSnapshot(fileContent: string): PromptSnapshot {
  const sepIndex = fileContent.indexOf(`\n${METADATA_SEPARATOR}\n`);
  if (sepIndex === -1) {
    throw new Error("Invalid snapshot file: missing metadata separator (---)");
  }

  const metadataBlock = fileContent.slice(0, sepIndex);
  const renderedText = fileContent.slice(sepIndex + METADATA_SEPARATOR.length + 2); // +2 for \n on each side

  const meta: Record<string, string> = {};
  for (const line of metadataBlock.split("\n")) {
    const colonIndex = line.indexOf(": ");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 2).trim();
    meta[key] = value;
  }

  const required = ["hash", "templateName", "templateVersion", "topicId", "gitCommit", "gitBranch", "createdAt"];
  for (const field of required) {
    if (!meta[field]) {
      throw new Error(`Invalid snapshot file: missing metadata field "${field}"`);
    }
  }

  const snapshot: PromptSnapshot = {
    hash: meta.hash!,
    renderedText,
    metadata: Object.freeze({
      templateName: meta.templateName!,
      templateVersion: meta.templateVersion!,
      topicId: meta.topicId!,
      gitCommit: meta.gitCommit!,
      gitBranch: meta.gitBranch!,
      createdAt: meta.createdAt!,
    }),
  };

  return Object.freeze(snapshot);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Get the filesystem path for a snapshot.
 *
 * Layout: <baseDir>/<template>/<topicId>/<hash>.md
 *
 * The template name has its extension stripped (deep-research.md → deep-research).
 * This creates a browseable directory tree:
 *
 *   snapshots/prompts/deep-research/dairy_harms_acne/a1b2c3d4e5f6.md
 *   snapshots/prompts/deep-research/turmeric_helps_redness/f6e5d4c3b2a1.md
 */
export function getSnapshotPath(
  templateName: string,
  topicId: string,
  hash: string,
  baseDir: string = DEFAULT_BASE_DIR
): string {
  const templateDir = templateName.replace(/\.[^.]+$/, "");
  return resolve(join(baseDir, templateDir, topicId, `${hash}.md`));
}

/**
 * Store a snapshot to disk.
 *
 * Creates the directory structure if it doesn't exist. If a snapshot
 * with the same hash already exists at the same path, it is NOT
 * overwritten — content-addressed storage is append-only by design.
 *
 * @param snapshot - The snapshot to store
 * @param baseDir  - Base directory for snapshot storage
 * @returns The full filesystem path where the snapshot was written
 */
export function storeSnapshot(
  snapshot: PromptSnapshot,
  baseDir: string = DEFAULT_BASE_DIR
): string {
  const filePath = getSnapshotPath(
    snapshot.metadata.templateName,
    snapshot.metadata.topicId,
    snapshot.hash,
    baseDir
  );

  // Content-addressed: if it already exists, the content is identical
  if (existsSync(filePath)) {
    return filePath;
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, serializeSnapshot(snapshot), "utf-8");
  return filePath;
}

/**
 * Load a snapshot from disk by its hash.
 *
 * @param hash         - The snapshot hash
 * @param templateName - Template filename
 * @param topicId      - Topic ID
 * @param baseDir      - Base directory for snapshot storage
 * @returns Load result with snapshot or error
 */
export function loadSnapshotByHash(
  hash: string,
  templateName: string,
  topicId: string,
  baseDir: string = DEFAULT_BASE_DIR
): SnapshotLoadResult {
  const filePath = getSnapshotPath(templateName, topicId, hash, baseDir);

  if (!existsSync(filePath)) {
    return {
      success: false,
      error: `Snapshot not found: ${filePath}`,
    };
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const snapshot = deserializeSnapshot(content);
    return { success: true, snapshot };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List all snapshot hashes for a given template + topic combination.
 *
 * @param templateName - Template filename
 * @param topicId      - Topic ID
 * @param baseDir      - Base directory for snapshot storage
 * @returns Array of snapshot hashes (sorted oldest first by filename)
 */
export function listSnapshots(
  templateName: string,
  topicId: string,
  baseDir: string = DEFAULT_BASE_DIR
): string[] {
  const templateDir = templateName.replace(/\.[^.]+$/, "");
  const dir = resolve(join(baseDir, templateDir, topicId));

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => basename(f, ".md"))
    .sort();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a snapshot's integrity by recomputing its hash.
 *
 * This is the core trust mechanism: given a snapshot loaded from disk,
 * recompute the SHA-256 of its rendered text and compare to the stored
 * hash. If they don't match, the content has been tampered with.
 *
 * @param snapshot - The snapshot to verify
 * @returns Verification result with both hashes
 */
export function verifySnapshot(snapshot: PromptSnapshot): SnapshotVerifyResult {
  const computedHash = computePromptHash(snapshot.renderedText);
  return {
    valid: computedHash === snapshot.hash,
    storedHash: snapshot.hash,
    computedHash,
  };
}
