/**
 * Prompt template loader.
 *
 * Loads prompt templates from disk (.md or .txt files), parses and validates
 * them, and exposes them for rendering.
 *
 * USAGE:
 *
 *   const loader = new PromptTemplateLoader("prompts/");
 *
 *   // Load a single template
 *   const tmpl = loader.load("deep-research.md");
 *
 *   // Load all templates in the directory
 *   const all = loader.loadAll();
 *
 *   // Get template metadata without loading
 *   const files = PromptTemplateLoader.listTemplates("prompts/");
 *
 * SCALABILITY:
 *
 * Templates are loaded and parsed once, then cached in memory.  For a
 * pipeline that processes hundreds of topics, create ONE loader instance
 * and reuse the parsed templates — only the context changes per topic.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename, resolve } from "node:path";

import {
  parseTemplate,
  TemplateParseError,
  type ParsedTemplate,
} from "./template.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TemplateLoadError extends Error {
  constructor(
    public readonly filePath: string,
    message?: string
  ) {
    super(message ?? `Failed to load template: ${filePath}`);
    this.name = "TemplateLoadError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** File extensions recognized as prompt templates. */
const TEMPLATE_EXTENSIONS = new Set([".md", ".txt"]);

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export class PromptTemplateLoader {
  private readonly baseDir: string;
  private readonly cache = new Map<string, ParsedTemplate>();

  /**
   * @param baseDir - Directory containing prompt template files
   */
  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);

    if (!existsSync(this.baseDir)) {
      throw new TemplateLoadError(
        this.baseDir,
        `Template directory does not exist: ${this.baseDir}`
      );
    }
  }

  /**
   * Load and parse a single template file.
   *
   * Results are cached — subsequent calls for the same filename return
   * the cached ParsedTemplate.
   *
   * @param filename - Filename relative to baseDir (e.g. "deep-research.md")
   * @returns Parsed and validated template
   * @throws TemplateLoadError   if file is missing or unreadable
   * @throws TemplateParseError  if template contains invalid variables
   */
  load(filename: string): ParsedTemplate {
    const cached = this.cache.get(filename);
    if (cached) return cached;

    const filePath = join(this.baseDir, filename);

    if (!existsSync(filePath)) {
      throw new TemplateLoadError(
        filePath,
        `Template file not found: ${filePath}`
      );
    }

    const ext = extname(filename).toLowerCase();
    if (!TEMPLATE_EXTENSIONS.has(ext)) {
      throw new TemplateLoadError(
        filePath,
        `Unsupported template extension "${ext}". Use: ${[...TEMPLATE_EXTENSIONS].join(", ")}`
      );
    }

    const source = readFileSync(filePath, "utf-8");
    const name = basename(filename, ext);
    const parsed = parseTemplate(source, name);

    this.cache.set(filename, parsed);
    return parsed;
  }

  /**
   * Load all template files in the base directory.
   *
   * Non-template files are silently skipped. Subdirectories are not
   * traversed (flat directory only).
   *
   * @returns Map of filename → ParsedTemplate
   * @throws TemplateParseError if any template has invalid variables
   */
  loadAll(): Map<string, ParsedTemplate> {
    const entries = readdirSync(this.baseDir);
    const result = new Map<string, ParsedTemplate>();

    for (const entry of entries) {
      const fullPath = join(this.baseDir, entry);
      if (!statSync(fullPath).isFile()) continue;

      const ext = extname(entry).toLowerCase();
      if (!TEMPLATE_EXTENSIONS.has(ext)) continue;

      result.set(entry, this.load(entry));
    }

    return result;
  }

  /**
   * Clear the internal template cache.
   * Useful if template files have been modified on disk.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * List template filenames in a directory without loading them.
   */
  static listTemplates(dir: string): string[] {
    const resolved = resolve(dir);
    if (!existsSync(resolved)) return [];

    return readdirSync(resolved).filter((entry) => {
      const full = join(resolved, entry);
      if (!statSync(full).isFile()) return false;
      return TEMPLATE_EXTENSIONS.has(extname(entry).toLowerCase());
    });
  }
}
