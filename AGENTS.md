# AGENTS.md

## Project identity

This project is called Jesus Words.

It is not a general Bible reader. It is a precision comparison tool for the spoken words of Jesus across DBH, NRSVUE, and LAMSA, anchored against BSB references.

The priority is clarity, accuracy, and clean comparison, not visual gimmicks.

## Main UX principles

1. The selected verse is always the primary focus.
2. Translation comparison is secondary.
3. Advanced alignment tools should be optional, not shown by default.
4. The UI should feel scholarly, calm, readable, and minimal.
5. Avoid debug-looking labels or raw pipeline artifacts in the user-facing interface.

## Data safety rules

Do not destructively rewrite data/jesus_verses_final.json unless explicitly asked.

Preserve all existing verse IDs, references, translation fields, difficulty fields, tags, alignment data, and metadata.

If data changes are needed, create a script and explain exactly what it changes before applying it.

## UI rules

The sidebar should show clean verse references like:

Matthew 3:15

Do not append difficulty labels inline like:

Matthew 3:15high

If difficulty is shown, use a subtle badge.

Translations should not all be stacked by default.

Use tabs:

DBH
NRSVUE
LAMSA
Compare

The Compare tab may show all three translations in clean cards.

Phrase Alignment should be hidden behind a collapsible Advanced Alignment section.

## Highlighting rules

Highlighting should be subtle and readable in light and dark mode.

Avoid excessive yellow highlighting.

Default highlighting should focus on meaning-level differences.

Do not let highlights make the text feel noisy.

## Code rules

Use plain HTML, CSS, and JavaScript unless the project is intentionally migrated.

Keep changes small and testable.

Do not add large frameworks.

Do not rename files unless necessary.

Do not break:

search
book filter
verse selection
dark mode
accessibility controls
existing dataset loading

## Rendering quality rules

Fix obvious spacing/rendering bugs, especially joined text like:

him“Let
nowfor
fulfilled;and

Generated display text should have readable spacing around quotes, punctuation, and phrase fragments.

## After every task

Summarize:

files changed
what changed
how to test locally
any risks or follow-up needed
