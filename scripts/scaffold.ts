#!/usr/bin/env node
/**
 * Scaffolding script for ABA research project structure.
 * Creates the standard folder layout with .gitkeep files.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const DIRECTORIES = [
  "config",
  "topics",
  "prompts",
  "pipelines",
  "data",
  "output",
] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scaffold(rootDir: string): Promise<void> {
  console.log(`Scaffolding project structure in: ${rootDir}`);

  for (const dir of DIRECTORIES) {
    const dirPath = join(rootDir, dir);
    const gitkeepPath = join(dirPath, ".gitkeep");

    if (await exists(dirPath)) {
      console.log(`  [exists] ${dir}/`);
    } else {
      await mkdir(dirPath, { recursive: true });
      console.log(`  [created] ${dir}/`);
    }

    if (!(await exists(gitkeepPath))) {
      await writeFile(gitkeepPath, "");
      console.log(`  [created] ${dir}/.gitkeep`);
    }
  }

  console.log("\nScaffolding complete.");
}

const rootDir = process.argv[2] ?? process.cwd();
scaffold(rootDir).catch((err: unknown) => {
  console.error("Scaffolding failed:", err);
  process.exit(1);
});
