# CLAUDE.md — Project Context for ABA-Research

## What This Project Is

ABA-Research is a TypeScript pipeline for **skin health research automation**. It defines atomic research topics about how specific entities (foods, herbs, ingredients, chemicals, practices, habits) help or harm skin conditions, validates them rigorously, assembles them into an immutable specification contract, and ultimately feeds that specification into Gemini Deep Research for evidence gathering. The research results are then used to compose various media formats (blog posts, emails, video scripts, newsletters, PDFs, social media, clinical summaries) with the help of LLMs.

The project name "ABA" stands for the brand's skin health research initiative. The brand is vegan, cruelty-free, science-backed, and emphasizes plant-based and Ayurvedic approaches.

## Architecture Overview

The system operates in phases:

```
Phase 1 (Implemented)          Phase 2 (Designed)           Phase 3 (Planned)
┌─────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
│ Config + Topics      │   │ Research Generation   │   │ Media Composition   │
│                      │   │                      │   │                     │
│ Load ResearchConfig  │──▶│ Deserialize Spec     │──▶│ Consume Results     │
│ Load Topics (atomic) │   │ Iterate Topics       │   │ Apply Standards     │
│ Load Standards       │   │ Gemini Deep Research │   │ Apply SEO Rules     │
│ Validate Everything  │   │ Gather Evidence      │   │ Generate Content    │
│ Build Specification  │   │ Save Research Results│   │ Output Media        │
│ Serialize to Disk    │   │                      │   │                     │
└─────────────────────┘   └──────────────────────┘   └─────────────────────┘
```

**Phase 1** produces a `ResearchSpecification` — an immutable, frozen JSON contract containing all topics, configuration, standards, indexes, and metadata needed to reproduce a research run.

**Phase 2** consumes that specification, iterating topics in deterministic order and using Gemini Deep Research to gather evidence-backed content for each atomic claim.

**Phase 3** takes the research results and composes them into various media formats, validated against content standards and SEO guidelines.

## Directory Structure

```
/
├── src/                          # TypeScript source
│   ├── index.ts                 # Entry point (init + logging)
│   ├── types/                   # Shared type definitions
│   │   ├── topic.ts            # Topic interface
│   │   ├── content.ts          # Content formats (Email, Blog, Video, Pdf)
│   │   ├── module.ts           # Research modules
│   │   ├── pipeline.ts         # Pipeline stage definitions
│   │   └── index.ts            # Barrel exports
│   ├── config/                  # Configuration management
│   │   ├── env.ts              # Environment variable loading (dotenv)
│   │   ├── index.ts            # Config exports
│   │   └── research/           # Research-specific configuration
│   │       ├── enums.ts        # BUSINESS-CRITICAL canonical domain enums
│   │       ├── schema.ts       # ResearchConfig Zod schema
│   │       ├── defaults.ts     # Default configuration values
│   │       ├── loader.ts       # Config loading + validation + freeze
│   │       └── index.ts        # Exports
│   ├── topics/                  # Topic management
│   │   ├── schema.ts           # TopicSchema with atomicity enforcement
│   │   ├── loader.ts           # Topic loading with validation modes
│   │   ├── validators.ts       # 9 atomicity validation rules
│   │   ├── registry.ts         # TopicRegistry with deterministic indexes
│   │   ├── index.ts            # Exports
│   │   ├── loader.test.ts      # Tests
│   │   └── validators.test.ts  # Tests
│   ├── standards/               # Content and SEO standards
│   │   ├── content-schema.ts   # ContentStandards Zod schema
│   │   ├── seo-schema.ts       # SeoGuidelines Zod schema
│   │   ├── loader.ts           # Standards loading + validation
│   │   └── index.ts            # Exports
│   ├── specification/           # Research specification (Phase 2 input)
│   │   ├── schema.ts           # ResearchSpecification Zod schema
│   │   ├── factory.ts          # Factory to create specifications
│   │   ├── metadata.ts         # Git state + run metadata capture
│   │   ├── serialization.ts    # Save/load specs with versioning
│   │   ├── index.ts            # Exports
│   │   └── specification.test.ts # Tests
│   ├── logging/                 # Observability
│   │   ├── logger.ts           # Console + file logging
│   │   ├── run-id.ts           # Run ID generation (timestamp + hash)
│   │   └── index.ts            # Exports
│   └── cli/                     # CLI tools
│       └── validate-config.ts  # Phase 1 validation CLI
├── config/                      # Configuration data files
│   ├── content-standards.json   # Tone, citations, forbidden content, brand rules
│   └── seo-guidelines.json      # Keywords, headings, readability, meta rules
├── topics/                      # Topic data files
│   └── sample-topics.json       # 12 example atomic topics
├── scripts/                     # Utility/test scripts
│   ├── scaffold.ts             # Project structure setup
│   ├── test-research-config.ts # Config loading tests
│   ├── test-specification.ts   # Spec creation/serialization tests
│   ├── test-topic-registry.ts  # Registry tests
│   └── test-standards.ts       # Standards loading tests
├── prompts/                     # Prompt templates (Phase 2, empty)
├── pipelines/                   # Pipeline definitions (Phase 2, empty)
├── data/                        # Input data (Phase 2, empty)
└── output/                      # Generated outputs (Phase 2, empty)
```

## Core Domain Concepts

### Atomic Topics

The fundamental unit of this system. Each topic represents **one entity**, making **one directional claim** (helps or harms), about **one skin condition**, within **one content category**. This atomicity is enforced through schema validation and 9 dedicated validators.

A topic looks like:
```json
{
  "id": "turmeric_helps_redness",
  "primaryEntity": "turmeric",
  "entityType": "herb",
  "claim": {
    "direction": "helps",
    "mechanism": "curcumin inhibits inflammatory cytokines (TNF-α, IL-6)",
    "confidence": "established"
  },
  "name": "Turmeric Reduces Skin Redness",
  "condition": "redness_hyperpigmentation",
  "category": "ayurvedic_herbs_in_skincare_that_help_skin",
  "priority": "high",
  "status": "active"
}
```

**Atomicity rules** (in `src/topics/validators.ts`):
1. No multiple entities ("turmeric and ginger" is rejected)
2. No generic plurals ("herbs" without specification)
3. No bucket phrases ("foods that help...")
4. No vague quantifiers ("various", "certain", "some")
5. No multiple claims in mechanism
6. No comma-separated lists in name
7. No lists in description
8. No compound entities ("fruits and vegetables")
9. No generic category names ("Best Foods for...")

### Skin Conditions (Canonical, Immutable)

Defined in `src/config/research/enums.ts` — **DO NOT MODIFY without business approval**:
- `redness_hyperpigmentation`
- `dryness_premature_aging`
- `oily_skin`
- `acne_acne_scars`

### Content Categories (Canonical, Immutable)

10 categories organized by beneficial vs. harmful:

**Beneficial (direction: "helps")**:
- `vegan_foods_that_help_skin`
- `ayurvedic_herbs_in_skincare_that_help_skin`
- `ayurvedic_herbs_to_eat_that_benefit_skin`
- `ayurvedic_practices_that_help_skin`
- `other_practices_that_help_skin`

**Harmful (direction: "harms")**:
- `animal_ingredients_in_food_that_harm_skin`
- `animal_ingredients_in_skincare_that_harm_skin`
- `other_foods_that_harm_skin`
- `skincare_chemicals_that_harm_skin`
- `habits_that_harm_skin`

Claim direction must align with category — harm categories require `direction: "harms"`, help categories require `direction: "helps"`.

### Entity Types

- `food` — Edible item (avocado, kale, dairy)
- `herb` — Medicinal plant (turmeric, neem, ashwagandha)
- `ingredient` — Skincare/cosmetic ingredient (retinol, lanolin)
- `chemical` — Synthetic compound (parabens, sulfates)
- `practice` — Behavioral/lifestyle practice (abhyanga, gua sha)
- `habit` — Daily habit (face touching, late sleeping)

### Research Specification

The immutable contract that flows between phases. Contains:
- **runMetadata**: runId, timestamp, git state, hostname
- **researchConfig**: quality requirements, source policy, model metadata
- **topics**: full atomic topic objects
- **topicSummaries**: lightweight references for quick iteration
- **topicIndexes**: pre-computed maps (byCondition, byCategory, byEntityType, byClaimDirection)
- **stats**: totals, breakdowns, active counts
- **contentStandards** (optional): tone, citations, forbidden content, brand rules
- **seoGuidelines** (optional): keywords, headings, readability, meta rules

Current schema version: `2.0.0`

## Key Design Principles

1. **Immutability** — All configs, topics, and specifications are deeply frozen after creation using `Object.freeze`. Nothing is mutable once validated.
2. **Determinism** — Topics sorted by ID everywhere. Indexes built in deterministic order. Same input always produces same output.
3. **Fail-Fast** — Validation errors throw immediately. Invalid topics are rejected at ingestion, not at research time.
4. **Atomicity Enforcement** — 9 validators + schema refinements ensure every topic is a single, actionable research unit.
5. **Declarative Constraints** — Content standards and SEO guidelines describe WHAT content must look like, not HOW to produce it.
6. **Auditability** — Every run captures git commit SHA, branch, dirty state, hostname, and timestamp.
7. **Reproducibility** — Specifications can be serialized to disk and deserialized for exact replay.
8. **Schema Versioning** — Specification version field enables forward-compatible migrations.

## Configuration Details

### Research Quality Requirements (defaults)
- Min 2 citations per claim
- Min 3 sources per topic
- Max 10-year-old sources
- Allowed evidence types: systematic review, meta-analysis, RCT, cohort study, clinical guideline
- Requires at least one high-quality source

### Source Policy (defaults)
- Allowed: peer-reviewed journals, review papers, clinical guidelines, government health agencies, professional associations
- No preprints allowed
- Peer review required
- Preferred databases: PubMed, Cochrane Library, MEDLINE

### Content Standards (`config/content-standards.json`)
- Tone: educational, informative, supportive; avoid alarmist or dismissive
- Reading level: grades 8-12
- Perspective: second person
- Forbidden phrases: "guaranteed cure", "miracle cure", "100% effective", etc.
- Required disclaimers: medical disclaimer, individual results disclaimer
- Brand values: vegan, cruelty-free, science-backed, plant-based emphasis

### SEO Guidelines (`config/seo-guidelines.json`)
- Primary keyword density: 1.0–2.5%
- Word count: 1,200–2,500 words
- Single H1 with primary keyword, minimum 3 H2 headings
- Flesch Reading Ease: 55–75
- Max 15% passive voice
- Meta title: 40–60 characters; meta description: 140–160 characters

## Commands

```bash
# Type checking
npm run typecheck

# Build
npm run build

# Run Phase 1 validation CLI
npm run validate-config

# Run individual test scripts
node --import tsx scripts/test-research-config.ts
node --import tsx scripts/test-specification.ts
node --import tsx scripts/test-topic-registry.ts
node --import tsx scripts/test-standards.ts

# Scaffold project directories
npm run scaffold
```

## Tech Stack

- **TypeScript** (ES2022 target, ESM modules)
- **Zod** for runtime schema validation with advanced refinements
- **Node.js** >= 18.0.0
- **dotenv** for environment variable management
- **tsx** for TypeScript execution without compilation

## Development Guidelines

- The enums in `src/config/research/enums.ts` are **business-critical and immutable**. Do not add, remove, or rename conditions or categories without explicit approval.
- All new topics must pass atomicity validation. One entity, one claim direction, one condition, one category.
- Claim direction must match the category's semantic grouping (help categories get `"helps"`, harm categories get `"harms"`).
- Topic IDs follow the convention `{entity}_{direction}_{condition_abbrev}` (e.g., `dairy_harms_acne`).
- All data structures are deeply frozen after creation. Do not attempt to mutate configs, topics, or specifications.
- Validation modes for topic loading: `strict` (default, errors block), `lenient` (errors collected), `skip` (no checking).
- When adding new functionality, place it in the appropriate existing module rather than creating new top-level directories.
- Tests are colocated with source files (e.g., `loader.test.ts` next to `loader.ts`) or in the `scripts/` directory for integration-style tests.

## Pipeline Flow (End-to-End)

1. **Define Topics** — Create atomic topic JSON entries in `topics/` following the schema
2. **Validate (Phase 1)** — Run `npm run validate-config` to load, validate, and assemble the specification
3. **Generate Prompt** — Use the specification's topics, indexes, and standards to construct a research prompt
4. **Research (Phase 2)** — Feed the prompt to Gemini Deep Research, which gathers evidence for each atomic claim
5. **Save Results** — Persist research output with the specification's runId for traceability
6. **Compose Media (Phase 3)** — Use LLMs to transform research results into blog posts, emails, video scripts, etc., validated against content standards and SEO guidelines
7. **Output** — Final media saved to `output/`, correlated by runId

## File Naming Conventions

- Specification files: `specification-{runId}.json`
- Source modules: kebab-case (`content-schema.ts`, `seo-schema.ts`)
- Test files: `{module}.test.ts` colocated with source
- Config data: kebab-case JSON (`content-standards.json`, `seo-guidelines.json`)
- Topic data: kebab-case JSON (`sample-topics.json`)
