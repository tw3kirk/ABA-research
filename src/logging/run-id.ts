/**
 * Run ID generation and management.
 * Each execution gets a unique run ID for tracing.
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a short, unique run ID.
 * Format: timestamp prefix + random suffix (e.g., "20240115-a1b2c3")
 */
export function generateRunId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(3).toString("hex");
  return `${datePart}-${randomPart}`;
}

/** Current run ID for this execution */
let currentRunId: string | null = null;

/**
 * Initialize a new run ID for this execution.
 * Should be called once at startup.
 */
export function initRunId(): string {
  currentRunId = generateRunId();
  return currentRunId;
}

/**
 * Get the current run ID.
 * Returns null if not initialized.
 */
export function getRunId(): string | null {
  return currentRunId;
}
