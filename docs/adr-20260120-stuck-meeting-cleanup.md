# ADR-20260120: Cleanup Stuck Meetings

Status: Accepted  
Date: 2026-01-20  
Owners: Platform

## Context

Some meetings remain in progress or processing after unexpected failures. These
records block cleanup, distort durations, and leave users without closure in the
meeting library. We need a scheduled cleanup that can mark these meetings as
failed, notify users, and record a clear end reason for auditing.

## Decision

1. Add a new meeting status of failed and a cleanup end reason.
2. Persist the text channel ID at meeting start to target cleanup
   notifications.
3. Add a scheduled Lambda job that scans for stuck meetings, applies conditional
   updates to mark them failed, and emits a cleanup metric.
4. Route cleanup notifications through a notifier interface so additional
   channels can be added later.

## Consequences

Positive:

- Stuck meetings become terminal, which keeps the library and timelines
  consistent.
- Cleanup notifications and metrics improve visibility into failures.
- Conditional updates keep the job idempotent.

Costs and risks:

- The cleanup scan can be more expensive than a GSI for large tables.
- Users may receive notifications for meetings that would have recovered
  naturally if the cutoff was too short.

## Alternatives Considered

1. Add a status and updatedAt GSI and query instead of scanning. This reduces
   scan cost but adds index maintenance.
2. Delete stuck meetings without marking them failed. This reduces noise but
   removes audit history.
3. Only update records without notifying users. This avoids extra messages but
   hides cleanup actions.

## Notes

If scan cost becomes a concern, revisit the GSI option and update the cleanup
job to query by status and timestamp.
