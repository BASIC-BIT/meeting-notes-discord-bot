# Dictionary Feature

## Overview

The dictionary feature lets server admins add domain terms and optional definitions so transcription, cleanup, summaries, and Ask can interpret jargon consistently. Definitions are optional and are hidden behind an explicit action in the UI to keep entry creation fast.

## Product decisions

- Scope: Dictionary entries are server scoped and shared across channels in the same guild.
- Definition optional: A term can be stored with or without a definition. The UI shows one input by default and reveals the definition field only when requested.
- Prompt usage: Transcription receives terms only, while cleanup, coalesce, notes, and Ask receive terms with definitions when provided.
- Budgeting: Prompt budgets are capped by entry count and character limits, with base and pro tiers and hard caps to avoid prompt bloat.

## Technical decisions

- Storage: `DictionaryTable` in DynamoDB with `guildId` as the hash key and `termKey` as the range key.
- Normalization: `termKey` is a normalized, lowercased term with collapsed whitespace. Entries are deduped by `termKey`.
- Ordering: Most recently updated entries are used first when building prompt lines.
- Constraints: Term length max 80, definition length max 400.
- Budgets: Config keys drive entry caps and character budgets for transcription and context prompts, plus tier based overrides and global caps.

## Prompt usage summary

- Transcription: Uses `Dictionary terms` as a list of terms only. Definitions are not included.
- Cleanup, coalesce, notes: Uses a `Dictionary` block with terms and definitions.
- Ask: Uses a `Dictionary` block alongside meeting context blocks to interpret proper nouns.

## Future ideas

- Optional automation that suggests dictionary entries from corrections or frequently corrected terms.
- LLM based pruning or selection of dictionary terms per meeting before injecting into prompts.
