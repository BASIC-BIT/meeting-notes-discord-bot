# ADR-20260106: Ask Citations with Render-on-Read

Status: Accepted
Date: 2026-01-06
Owners: Ask experience

## Context

Ask answers should feel like search results with clear citations instead of a
chatty response. We also want URL flexibility while the product is still
evolving, which means we should not persist rendered URLs inside stored answers.
The ask prompt already encourages research-style formatting, but the model
previously emitted raw URLs and sometimes mis-attributed archive status across
meetings.

## Decision

1. Always include explicit Status and an index in each meeting context block.
2. Require the model to cite sources using structured tags
   (`<chronote:cite index="N" target="portal|discord_summary" />`) and forbid
   raw URLs or markdown links in the model output.
3. Store raw model output with tags plus structured citation metadata in Dynamo.
4. Render citations into links at read time based on the current URL scheme,
   and keep the stored raw output stable for future rendering changes.

## Consequences

Positive:

- Answers present as search-style results with numbered citations and a sources
  list.
- URLs can evolve without migrating stored ask data.
- Citation metadata is available for exports and future UI features.

Costs and risks:

- Rendering logic must exist at every read surface (Ask UI, Discord responses,
  legacy API).
- Citation tags must be stripped for history prompts and summaries to avoid
  prompt leakage.

## Alternatives Considered

1. Render URLs before storage. This simplifies reads but locks stored data to
   current URL formats.
2. Store only rendered text and recalculate on demand. This loses tag context
   and makes citation extraction unreliable.
3. Use model-generated markdown links directly. This adds URL brittleness and
   increases hallucination risk.

## Notes

Future work may extend citations to transcript event IDs for deep linking into
the meeting timeline.
