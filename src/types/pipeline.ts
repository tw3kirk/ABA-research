/**
 * Pipeline and stage definitions.
 * Pipelines orchestrate sequences of research modules.
 */

export enum StageStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Skipped = "skipped",
  Failed = "failed",
}

export interface StageMetadata {
  readonly id: string;
  readonly name: string;
}

export interface PipelineStage extends StageMetadata {
  readonly moduleId: string;
  readonly dependsOn?: readonly string[];
  readonly config?: Record<string, unknown>;
}

export interface PipelineMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface Pipeline extends PipelineMetadata {
  readonly stages: readonly PipelineStage[];
  readonly config?: Record<string, unknown>;
}
