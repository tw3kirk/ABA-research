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
