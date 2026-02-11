/**
 * Prompt constraint generation and injection.
 *
 * PromptConstraints are **programmatically derived** guardrails that are
 * appended to every rendered prompt. Unlike template content (which authors
 * can edit) and conditional blocks (which select structural variants),
 * constraints are **centrally enforced** — templates cannot omit, weaken,
 * or reorder them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DESIGN: WHY CONSTRAINTS LIVE OUTSIDE TEMPLATES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Templates are editable text files. Any guardrail placed inside a template
 * can be accidentally deleted, rephrased, or moved. At scale (hundreds of
 * topics × multiple templates), even small phrasing drift causes:
 *
 *   1. IDEOLOGICAL INCONSISTENCY — a "harms" topic that omits the exclusion
 *      "Do not include evidence showing inverse relationships" might produce
 *      content that subtly contradicts the brand's position.
 *
 *   2. EVIDENCE STANDARD DRIFT — a template that drops "Minimum 3 sources"
 *      produces lower-quality output for some topics but not others, making
 *      the corpus inconsistent.
 *
 *   3. UNDETECTABLE REGRESSION — with constraints embedded in templates,
 *      a diff that changes "Do NOT cite preprints" to "Avoid preprints"
 *      looks like a copy edit but weakens the policy.
 *
 * By generating constraints programmatically from the ResearchSpecification
 * and ContentStandards, and injecting them as an immutable block that the
 * renderer appends unconditionally, we guarantee:
 *
 *   - Same inputs → identical constraint text (deterministic)
 *   - Templates cannot suppress constraints (enforced centrally)
 *   - Changes require code changes with tests (auditable)
 *   - All topics get identical base constraints + direction-specific rules
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONSTRAINT SOURCES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   ResearchSpecification.researchConfig.qualityRequirements
 *     → evidence count rules, source age limits, allowed evidence types
 *
 *   ResearchSpecification.researchConfig.sourcePolicy
 *     → preprint policy, peer review requirement, excluded publishers
 *
 *   ContentStandards.forbidden
 *     → forbidden phrases, forbidden claim categories
 *
 *   ContentStandards.brand
 *     → dietary alignment exclusions (e.g. no pro-animal-testing framing)
 *
 *   Topic.claim.direction
 *     → directional exclusions ("helps" topics must not argue entity harms,
 *       "harms" topics must not argue entity helps)
 *
 *   Topic.category
 *     → category-specific exclusions (e.g. animal-ingredient categories
 *       must include ethical/welfare framing constraints)
 */

import type { Topic } from "../topics/schema.js";
import type { ContentStandards } from "../standards/content-schema.js";
import type { ResearchSpecification } from "../specification/schema.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single constraint rule with a category label.
 */
export interface ConstraintRule {
  /** Which aspect this constraint governs. */
  category: "evidence" | "exclusion" | "source_policy" | "brand" | "forbidden_content";
  /** The constraint text, written as a directive. */
  text: string;
}

/**
 * The complete set of constraints for a single topic render.
 *
 * Constraints are divided into two groups:
 *   - `universal`: apply to every topic regardless of direction/category
 *   - `directional`: apply based on claim direction and/or category
 *
 * Both groups are injected together. The separation is for testing
 * and introspection only — at render time they are concatenated.
 */
export interface PromptConstraints {
  /** Rules that apply to every topic. */
  universal: readonly ConstraintRule[];
  /** Rules derived from claim direction and category. */
  directional: readonly ConstraintRule[];
}

/**
 * Input for building prompt constraints.
 */
export interface ConstraintInput {
  topic: Readonly<Topic>;
  specification?: Readonly<ResearchSpecification>;
  contentStandards?: Readonly<ContentStandards>;
}

// ---------------------------------------------------------------------------
// Category groupings (from enums.ts, kept in sync by convention)
// ---------------------------------------------------------------------------

const ANIMAL_CATEGORIES = new Set([
  "animal_ingredients_in_food_that_harm_skin",
  "animal_ingredients_in_skincare_that_harm_skin",
]);

const HARM_CATEGORIES = new Set([
  "animal_ingredients_in_food_that_harm_skin",
  "animal_ingredients_in_skincare_that_harm_skin",
  "other_foods_that_harm_skin",
  "skincare_chemicals_that_harm_skin",
  "habits_that_harm_skin",
]);

const HELP_CATEGORIES = new Set([
  "vegan_foods_that_help_skin",
  "ayurvedic_herbs_in_skincare_that_help_skin",
  "ayurvedic_herbs_to_eat_that_benefit_skin",
  "ayurvedic_practices_that_help_skin",
  "other_practices_that_help_skin",
]);

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build prompt constraints programmatically from domain objects.
 *
 * This function is **pure and deterministic**: same inputs always produce
 * the same constraints in the same order. This guarantees that re-rendering
 * a prompt for the same topic produces identical constraint text.
 *
 * @param input - Topic (required), specification and content standards (optional)
 * @returns Frozen PromptConstraints with universal + directional rules
 */
export function buildPromptConstraints(input: ConstraintInput): PromptConstraints {
  const { topic, specification, contentStandards } = input;

  const universal: ConstraintRule[] = [];
  const directional: ConstraintRule[] = [];

  // ── Universal: evidence requirements (from specification) ────────────
  if (specification) {
    const qr = specification.researchConfig.qualityRequirements;

    universal.push({
      category: "evidence",
      text: `Every factual claim MUST be supported by at least ${qr.minCitationsPerClaim} citation(s).`,
    });

    universal.push({
      category: "evidence",
      text: `Each topic MUST reference at least ${qr.minSourcesPerTopic} independent source(s).`,
    });

    if (qr.maxSourceAgeYears > 0) {
      universal.push({
        category: "evidence",
        text: `All sources MUST be published within the last ${qr.maxSourceAgeYears} years.`,
      });
    }

    const allowedTypes = qr.allowedEvidenceTypes.join(", ");
    universal.push({
      category: "evidence",
      text: `Only the following evidence types are acceptable: ${allowedTypes}.`,
    });

    const requireHighQuality = "requireHighQualitySource" in qr
      ? (qr as Record<string, unknown>).requireHighQualitySource
      : "requireAtLeastOneHighQuality" in qr
        ? (qr as Record<string, unknown>).requireAtLeastOneHighQuality
        : false;
    if (requireHighQuality) {
      universal.push({
        category: "evidence",
        text: "At least one source MUST be a systematic review, meta-analysis, RCT, or clinical guideline.",
      });
    }
  }

  // ── Universal: source policy (from specification) ────────────────────
  if (specification) {
    const sp = specification.researchConfig.sourcePolicy;

    if (!sp.allowPreprints) {
      universal.push({
        category: "source_policy",
        text: "Do NOT cite preprints or non-peer-reviewed publications.",
      });
    }

    if (sp.requirePeerReview) {
      universal.push({
        category: "source_policy",
        text: "All primary sources MUST be from peer-reviewed publications.",
      });
    }

    if ("excludedPublishers" in sp) {
      const excluded = (sp as Record<string, unknown>).excludedPublishers;
      if (Array.isArray(excluded) && excluded.length > 0) {
        universal.push({
          category: "source_policy",
          text: `Do NOT cite sources from: ${excluded.join(", ")}.`,
        });
      }
    }

    if ("excludedDomains" in sp) {
      const excluded = (sp as Record<string, unknown>).excludedDomains;
      if (Array.isArray(excluded) && excluded.length > 0) {
        universal.push({
          category: "source_policy",
          text: `Do NOT reference content from these domains: ${excluded.join(", ")}.`,
        });
      }
    }
  }

  // ── Universal: forbidden content (from content standards) ────────────
  if (contentStandards) {
    const forbidden = contentStandards.forbidden;

    if (forbidden.exactPhrases.length > 0) {
      universal.push({
        category: "forbidden_content",
        text: `The following phrases MUST NOT appear: ${forbidden.exactPhrases.map((p) => `"${p}"`).join(", ")}.`,
      });
    }

    for (const claim of forbidden.forbiddenClaims) {
      universal.push({
        category: "forbidden_content",
        text: `Forbidden claim category [${claim.category}]: ${claim.description}`,
      });
    }
  }

  // ── Universal: brand alignment (from content standards) ──────────────
  if (contentStandards) {
    const brand = contentStandards.brand;

    if (brand.dietaryAlignment.includes("vegan" as any)) {
      universal.push({
        category: "brand",
        text: "Content MUST align with vegan values. Do NOT frame animal-derived ingredients as superior to plant-based alternatives.",
      });
    }

    if (brand.dietaryAlignment.includes("cruelty_free" as any)) {
      universal.push({
        category: "brand",
        text: "Do NOT present animal testing as acceptable or necessary. Reference cruelty-free alternatives where relevant.",
      });
    }

    if (brand.deemphasize.length > 0) {
      universal.push({
        category: "brand",
        text: `Minimize emphasis on: ${brand.deemphasize.join(", ")}.`,
      });
    }
  }

  // ── Directional: claim direction exclusions ──────────────────────────
  if (topic.claim.direction === "helps") {
    directional.push({
      category: "exclusion",
      text: `Do NOT include evidence that "${topic.primaryEntity}" harms "${topic.condition}". This topic asserts a beneficial relationship only.`,
    });

    directional.push({
      category: "exclusion",
      text: "Do NOT include disclaimers that undermine the beneficial claim unless required by evidence strength caveats.",
    });
  }

  if (topic.claim.direction === "harms") {
    directional.push({
      category: "exclusion",
      text: `Do NOT include evidence that "${topic.primaryEntity}" helps "${topic.condition}". This topic asserts a harmful relationship only.`,
    });

    directional.push({
      category: "exclusion",
      text: "Do NOT include framing that normalizes or minimizes the harmful effect.",
    });
  }

  // ── Directional: category-specific constraints ───────────────────────
  if (ANIMAL_CATEGORIES.has(topic.category)) {
    directional.push({
      category: "exclusion",
      text: "Include ethical and animal welfare considerations. Do NOT omit cruelty-free or vegan alternatives.",
    });

    directional.push({
      category: "brand",
      text: `When discussing "${topic.primaryEntity}", always present plant-based or synthetic alternatives as the preferred option.`,
    });
  }

  if (topic.category === "skincare_chemicals_that_harm_skin") {
    directional.push({
      category: "exclusion",
      text: "Reference regulatory safety data (FDA, EU SCCS). Do NOT present industry-funded studies without noting the funding source.",
    });
  }

  if (HELP_CATEGORIES.has(topic.category) && topic.entityType === "herb") {
    directional.push({
      category: "evidence",
      text: "When citing traditional or Ayurvedic use, clearly distinguish traditional evidence from clinical trial evidence.",
    });
  }

  if (topic.category === "habits_that_harm_skin") {
    directional.push({
      category: "exclusion",
      text: "Focus on modifiable behaviors. Do NOT include genetic predispositions or non-modifiable risk factors as the primary framing.",
    });
  }

  // ── Directional: confidence-level constraints ────────────────────────
  if (topic.claim.confidence === "preliminary") {
    directional.push({
      category: "evidence",
      text: "The evidence base is preliminary. Clearly flag where evidence is limited to in-vitro, animal, or small-sample studies.",
    });
  }

  if (topic.claim.confidence === "emerging") {
    directional.push({
      category: "evidence",
      text: "The evidence is emerging. Use hedging language (e.g., \"suggests\", \"may\", \"preliminary data indicates\") for claims lacking strong RCT support.",
    });
  }

  return Object.freeze({
    universal: Object.freeze(universal),
    directional: Object.freeze(directional),
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Section heading used when injecting constraints into prompts. */
const CONSTRAINTS_HEADING = "## Constraints & Exclusions";

/** Subheading for universal constraints. */
const UNIVERSAL_SUBHEADING = "### Universal Constraints";

/** Subheading for directional constraints. */
const DIRECTIONAL_SUBHEADING = "### Topic-Specific Constraints";

/**
 * Format PromptConstraints as a markdown string for prompt injection.
 *
 * The output is deterministic: same constraints → same string, always.
 * This function is the sole serializer — no other code path produces
 * constraint text — ensuring format consistency across all prompts.
 */
export function formatConstraints(constraints: PromptConstraints): string {
  const lines: string[] = [CONSTRAINTS_HEADING, ""];

  if (constraints.universal.length > 0) {
    lines.push(UNIVERSAL_SUBHEADING, "");
    for (const rule of constraints.universal) {
      lines.push(`- [${rule.category}] ${rule.text}`);
    }
    lines.push("");
  }

  if (constraints.directional.length > 0) {
    lines.push(DIRECTIONAL_SUBHEADING, "");
    for (const rule of constraints.directional) {
      lines.push(`- [${rule.category}] ${rule.text}`);
    }
    lines.push("");
  }

  if (constraints.universal.length === 0 && constraints.directional.length === 0) {
    lines.push("No additional constraints for this topic.", "");
  }

  return lines.join("\n");
}

/**
 * Get the total number of constraint rules.
 */
export function countConstraints(constraints: PromptConstraints): number {
  return constraints.universal.length + constraints.directional.length;
}
