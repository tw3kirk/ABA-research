/**
 * Research topic definitions.
 * Topics represent high-level research areas or subjects.
 */

export interface TopicMetadata {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface Topic extends TopicMetadata {
  readonly parentId?: string;
  readonly config?: Record<string, unknown>;
}
