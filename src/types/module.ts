/**
 * Research module definitions.
 * Modules are discrete units of research functionality.
 */

export enum ModuleStatus {
  Idle = "idle",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
}

export interface ModuleMetadata {
  readonly id: string;
  readonly name: string;
  readonly version?: string;
}

export interface ModuleInput {
  readonly type: string;
  readonly required?: boolean;
}

export interface ModuleOutput {
  readonly type: string;
}

export interface ResearchModule extends ModuleMetadata {
  readonly inputs?: Record<string, ModuleInput>;
  readonly outputs?: Record<string, ModuleOutput>;
  readonly config?: Record<string, unknown>;
}
