/**
 * Run metadata capture utilities.
 *
 * Captures contextual information about the execution environment
 * to enable reproducibility and auditing.
 */

import { execSync } from "node:child_process";
import { hostname } from "node:os";
import type { GitState, RunMetadata } from "./schema.js";

/**
 * Attempt to capture current git state.
 * Returns undefined if not in a git repository or git is unavailable.
 */
export function captureGitState(): GitState | undefined {
  try {
    // Check if we're in a git repository
    execSync("git rev-parse --git-dir", { stdio: "pipe" });

    // Get commit SHA
    const commitSha = execSync("git rev-parse HEAD", { stdio: "pipe" })
      .toString()
      .trim();

    const commitShort = commitSha.substring(0, 7);

    // Get branch name
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" })
      .toString()
      .trim();

    // Check for uncommitted changes
    const statusOutput = execSync("git status --porcelain", { stdio: "pipe" })
      .toString()
      .trim();
    const isDirty = statusOutput.length > 0;

    // Get commit date
    const commitDateRaw = execSync("git log -1 --format=%cI", { stdio: "pipe" })
      .toString()
      .trim();

    return {
      commitSha,
      commitShort,
      branch,
      isDirty,
      commitDate: commitDateRaw,
    };
  } catch {
    // Not in a git repository or git not available
    return undefined;
  }
}

/**
 * Options for creating run metadata.
 */
export interface RunMetadataOptions {
  /** Run ID (required) */
  runId: string;

  /** Override start timestamp (defaults to now) */
  startedAt?: Date;

  /** User who initiated the run */
  initiatedBy?: string;

  /** Whether to capture git state */
  captureGit?: boolean;

  /** Whether to capture hostname */
  captureHostname?: boolean;

  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Create run metadata with current environment context.
 *
 * @param options - Metadata options
 * @returns Populated run metadata
 */
export function createRunMetadata(options: RunMetadataOptions): RunMetadata {
  const startedAt = options.startedAt ?? new Date();

  const metadata: RunMetadata = {
    runId: options.runId,
    startedAt: startedAt.toISOString(),
  };

  // Capture hostname if requested (default: true)
  if (options.captureHostname !== false) {
    try {
      metadata.hostname = hostname();
    } catch {
      // Hostname capture failed, skip
    }
  }

  // Capture git state if requested (default: true)
  if (options.captureGit !== false) {
    const gitState = captureGitState();
    if (gitState) {
      metadata.git = gitState;
    }
  }

  // Add initiatedBy if provided
  if (options.initiatedBy) {
    metadata.initiatedBy = options.initiatedBy;
  }

  // Add context if provided
  if (options.context && Object.keys(options.context).length > 0) {
    metadata.context = options.context;
  }

  return metadata;
}
