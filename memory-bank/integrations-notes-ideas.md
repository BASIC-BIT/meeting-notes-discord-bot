# Integrations & Personal Notes Ideas (Backlog)

## Goals

- Let users bring their own notes into Ask (personal, campaign logs, docs).
- Let users export Chronote outputs to other tools (Notion/Obsidian/Zapier/etc.).
- Keep initial scope small and reversible while building toward richer “memory” sources.

## Candidate Directions

### 1) Outbound first (lowest risk)

- Webhook/Zapier-style export of meeting notes + transcript + metadata.
- Optional per‑server destinations (Notion page, Google Docs, generic webhook).
- Pros: easy to reason about, no auth proxying; low support burden.
- Cons: doesn’t improve Ask quality directly.

### 2) Inbound personal notes (user‑provided)

- Simple upload/URL import: user drops markdown/text or connects a source.
- Ask queries include “personal notes” context for that user + server.
- Pros: immediate Ask value, clear user intent.
- Cons: needs storage + access control + consent UX.

### 3) Notion integration (OAuth)

- Per‑user connection; select pages/databases to sync.
- Scheduled sync to internal store; Ask can reference.
- Pros: huge user value for teams; good ROI.
- Cons: OAuth, rate limits, sync complexity.

### 4) Obsidian / local‑first

- Plugin or “watch folder” upload flow.
- Pros: aligns with personal workflows.
- Cons: more tooling, device‑local complexity.

### 5) MCP approach (advanced / later)

- Hosted MCP that exposes user data to LLM tools.
- Requires secure auth and per‑user scoping.
- Pros: flexible and composable.
- Cons: heavy infra + security surface.

## UX Thoughts

- “Bring your notes” entry in Ask: connect a source, or upload text.
- Per‑server opt‑in: keep personal notes scoped by server.
- Clear permission copy: “Only you can see personal notes in Ask.”

## Data / Service Notes

- Keep a dedicated “notes source” concept (type, owner, server, lastSyncAt).
- Store raw text + optional chunked artifacts for retrieval later.
- Start with 1‑2 sources (manual upload + webhook export) before OAuth.

## Open Questions

- Should personal notes be private to user or shared per server?
- How do we surface citations from external notes vs. meetings?
- Retention policy for imported notes?

## Suggested Phase Order

1. Outbound webhooks (Zapier-compatible) + manual upload.
2. Notion OAuth import.
3. Obsidian or MCP path.
