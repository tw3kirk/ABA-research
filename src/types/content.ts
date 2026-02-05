/**
 * Content target definitions.
 * Targets represent output formats for research content.
 */

export enum ContentFormat {
  Email = "email",
  Blog = "blog",
  Video = "video",
  Pdf = "pdf",
}

export interface ContentMetadata {
  readonly id: string;
  readonly title?: string;
  readonly createdAt?: Date;
}

export interface ContentTarget extends ContentMetadata {
  readonly format: ContentFormat;
  readonly config?: Record<string, unknown>;
}
