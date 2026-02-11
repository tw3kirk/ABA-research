# Deep Research Prompt — {{topic.entity}}

## Research Context

**Run ID:** {{research.runId}}
**Specification Version:** {{research.version}}
**Started:** {{research.startedAt}}

## Topic

**Entity:** {{topic.entity}} ({{topic.entityType}})
**Condition:** {{topic.condition}}
**Claim Direction:** {{topic.claim.direction}}
**Claim Mechanism:** {{topic.claim.mechanism}}
**Confidence Level:** {{topic.claim.confidence}}
**Category:** {{topic.category}}

## Research Task

Investigate whether **{{topic.entity}}** {{topic.claim.direction}} **{{topic.condition}}**.

Focus on the proposed mechanism: {{topic.claim.mechanism}}.

{{#if topic.claim.direction == "harms"}}
### Harm-Specific Research Requirements

- Identify specific harmful pathways and dose-response relationships
- Document severity levels and reversibility of effects
- Include ethical and welfare considerations where relevant
- Note any regulatory warnings or bans associated with {{topic.entity}}
{{/if}}

{{#if topic.claim.direction == "helps"}}
### Benefit-Specific Research Requirements

- Document effective dosage ranges and delivery methods
- Include bioavailability data for {{topic.entity}}
- Note synergistic or antagonistic interactions with other treatments
- Summarize traditional use history alongside modern evidence
{{/if}}

{{#if topic.category == "animal_ingredients_in_food_that_harm_skin"}}
### Animal-Ingredient Dietary Research

- Investigate hormonal pathways (e.g., IGF-1, mTORC1) triggered by {{topic.entity}}
- Compare skin outcomes with plant-based alternatives
- Include epidemiological data linking {{topic.entity}} consumption to {{topic.condition}}
{{/if}}

{{#if topic.category == "animal_ingredients_in_skincare_that_harm_skin"}}
### Animal-Ingredient Skincare Research

- Document allergenic or irritant mechanisms of {{topic.entity}} in topical application
- List cruelty-free and vegan alternatives with equivalent efficacy
- Note any regulatory restrictions on {{topic.entity}} in cosmetics
{{/if}}

{{#if topic.category == "skincare_chemicals_that_harm_skin"}}
### Synthetic Chemical Research

- Investigate endocrine disruption potential of {{topic.entity}}
- Document cumulative exposure risks and bioaccumulation
- Reference safety assessments from regulatory bodies (FDA, EU SCCS)
{{/if}}

{{#if topic.category == "ayurvedic_herbs_in_skincare_that_help_skin"}}
### Ayurvedic Topical Herb Research

- Reference classical Ayurvedic texts describing {{topic.entity}} for skin
- Include modern clinical data on topical formulations containing {{topic.entity}}
- Note any standardized extract concentrations used in studies
{{/if}}

{{#if topic.category == "ayurvedic_herbs_to_eat_that_benefit_skin"}}
### Ayurvedic Dietary Herb Research

- Reference Ayurvedic dosha theory relevant to {{topic.entity}} and {{topic.condition}}
- Include oral bioavailability data for active compounds
- Document traditional preparation methods (decoctions, powders, teas)
{{/if}}

{{#if topic.category == "ayurvedic_practices_that_help_skin"}}
### Ayurvedic Practice Research

- Describe the traditional protocol for {{topic.entity}} in detail
- Include any clinical trials or observational studies on this practice
- Note contraindications and safety precautions
{{/if}}

{{#if topic.category == "vegan_foods_that_help_skin"}}
### Plant-Based Nutrition Research

- Identify specific phytonutrients in {{topic.entity}} relevant to {{topic.condition}}
- Include recommended daily intake and food preparation guidance
- Note nutrient bioavailability and absorption enhancers
{{/if}}

{{#if topic.category == "habits_that_harm_skin"}}
### Behavioral Habit Research

- Quantify the impact of {{topic.entity}} on {{topic.condition}} with measurable outcomes
- Include behavioral modification strategies and their success rates
- Note how long cessation takes to show skin improvement
{{/if}}

{{#if topic.category == "other_practices_that_help_skin"}}
### Non-Ayurvedic Practice Research

- Document the evidence base for {{topic.entity}} as a skin health practice
- Include protocol details (frequency, duration, technique)
- Compare efficacy with conventional treatments for {{topic.condition}}
{{/if}}

{{#if topic.category == "other_foods_that_harm_skin"}}
### Harmful Food Research

- Identify specific compounds in {{topic.entity}} that aggravate {{topic.condition}}
- Include dose-response data and threshold levels
- Note common dietary sources and hidden forms of {{topic.entity}}
{{/if}}

{{#if topic.condition == "acne_acne_scars"}}
### Acne-Specific Considerations

- Address both active acne and post-inflammatory scarring
- Include sebum production and comedogenicity data
- Note hormonal pathways (androgens, insulin) if relevant to {{topic.entity}}
{{/if}}

{{#if topic.condition == "redness_hyperpigmentation"}}
### Redness & Hyperpigmentation Considerations

- Distinguish between inflammatory redness and melanin-based hyperpigmentation
- Include data on melanogenesis inhibition or anti-inflammatory markers
- Note photosensitivity interactions with {{topic.entity}}
{{/if}}

{{#if topic.condition == "dryness_premature_aging"}}
### Dryness & Aging Considerations

- Include transepidermal water loss (TEWL) data if available
- Address collagen synthesis, elastin preservation, and antioxidant activity
- Note environmental factors that compound dryness effects
{{/if}}

{{#if topic.condition == "oily_skin"}}
### Oily Skin Considerations

- Include sebum regulation and sebocyte activity data
- Address pore size, shine reduction, and mattifying effects
- Note the relationship between oiliness and skin barrier function
{{/if}}

{{#if topic.claim.confidence == "preliminary"}}
### Low-Confidence Evidence Note

The current evidence for this claim is **preliminary**. Apply extra scrutiny:
- Prioritize any available systematic reviews or meta-analyses
- Flag if evidence relies heavily on in-vitro or animal studies
- Clearly state the limitations of the current evidence base
{{/if}}

### Quality Requirements

- Minimum **{{research.minCitationsPerClaim}}** citations per claim
- Minimum **{{research.minSourcesPerTopic}}** independent sources per topic
- Sources must be published within the last **{{research.maxSourceAgeYears}}** years
- Allowed evidence types: {{research.allowedEvidenceTypes}}
- Preferred databases: {{research.preferredDatabases}}

### Content Standards

- **Tone:** {{contentStandards.tone}} ({{contentStandards.perspective}} perspective)
- **Reading level:** grade {{contentStandards.readingLevelMin}}–{{contentStandards.readingLevelMax}}
- **Citation format:** {{contentStandards.citationFormat}} with minimum {{contentStandards.minReferences}} references
- **Citations required for:** {{contentStandards.citationRequiredFor}}
- **Brand values:** {{contentStandards.brandValues}}
- **Emphasize:** {{contentStandards.emphasize}}
- **De-emphasize:** {{contentStandards.deemphasize}}

### Forbidden Content

Do NOT use these phrases: {{contentStandards.forbiddenPhrases}}

### Required Disclaimers

{{contentStandards.requiredDisclaimers}}

### SEO Guidelines

- **Word count:** {{seo.wordCountMin}}–{{seo.wordCountMax}} words
- **Primary keyword density:** {{seo.keywordDensityMin}}%–{{seo.keywordDensityMax}}%
- **Minimum H2 headings:** {{seo.minH2Count}}
- **Max heading words:** {{seo.maxHeadingWords}}
- **Meta title length:** {{seo.metaTitleLengthMin}}–{{seo.metaTitleLengthMax}} characters
- **Meta description length:** {{seo.metaDescriptionLengthMin}}–{{seo.metaDescriptionLengthMax}} characters
- **Flesch Reading Ease:** {{seo.fleschReadingEaseMin}}–{{seo.fleschReadingEaseMax}}
- **Max passive voice:** {{seo.maxPassiveVoicePercent}}%

## Output Format

Produce a structured research report for topic **{{topic.name}}** (ID: {{topic.id}}).
