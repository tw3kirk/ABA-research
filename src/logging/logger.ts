/**
 * Lightweight logging utility.
 * Outputs to both console and log file with timestamps and run ID.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getRunId } from "./run-id.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LoggerOptions {
  /** Minimum log level to output */
  level?: LogLevel;
  /** Directory for log files */
  logDir?: string;
  /** Log file name (without path) */
  logFile?: string;
  /** Enable console output */
  console?: boolean;
  /** Enable file output */
  file?: boolean;
}

const DEFAULT_OPTIONS: Required<LoggerOptions> = {
  level: "info",
  logDir: "output/logs",
  logFile: "app.log",
  console: true,
  file: true,
};

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Format a log entry with timestamp, level, run ID, and message.
 */
function formatLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const runId = getRunId() ?? "no-run-id";
  const levelStr = level.toUpperCase().padEnd(5);

  let entry = `[${timestamp}] [${levelStr}] [${runId}] ${message}`;

  if (context && Object.keys(context).length > 0) {
    entry += ` ${JSON.stringify(context)}`;
  }

  return entry;
}

/**
 * Get console method for log level.
 */
function getConsoleMethod(level: LogLevel): typeof console.log {
  switch (level) {
    case "debug":
      return console.debug;
    case "info":
      return console.info;
    case "warn":
      return console.warn;
    case "error":
      return console.error;
  }
}

/**
 * Create a logger instance.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const opts: Required<LoggerOptions> = { ...DEFAULT_OPTIONS, ...options };
  const logFilePath = join(opts.logDir, opts.logFile);

  // Ensure log directory exists
  if (opts.file && !existsSync(opts.logDir)) {
    mkdirSync(opts.logDir, { recursive: true });
  }

  function log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): void {
    // Check if this level should be logged
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[opts.level]) {
      return;
    }

    const entry = formatLogEntry(level, message, context);

    // Console output
    if (opts.console) {
      getConsoleMethod(level)(entry);
    }

    // File output
    if (opts.file) {
      try {
        appendFileSync(logFilePath, entry + "\n");
      } catch (err) {
        // Fallback to console if file write fails
        console.error(`Failed to write to log file: ${err}`);
      }
    }
  }

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}
