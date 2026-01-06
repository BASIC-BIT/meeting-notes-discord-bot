# ADR-20260106: Voice Receiver Resubscribe on Opus Decode Failures

Status: Accepted  
Date: 2026-01-06  
Owners: Audio pipeline

## Context

We observed meetings where a single speaker stops producing PCM frames for the
rest of the meeting. The logs show repeated "Speaking event ended with no PCM
frames" for that user and occasional Opus decoder errors such as "The compressed
data passed is corrupted." The receiver continues to emit speaking events, but
the decoded audio stream produces no data, which results in missing
transcriptions for that speaker.

This is not a snippet length issue. The failure is per-user and persists after
the initial decoder error, which points to a stuck or corrupted voice
subscription.

## Decision

Add per-user voice subscription recovery:

1. Track subscription state per user in memory.
2. On Opus decoder errors, opus stream errors, decoded stream errors, or stream
   close or end events, schedule a resubscribe for that user.
3. When speaking ends with no PCM frames, log `lastPcmAgoMs` and trigger a
   resubscribe after a short window of repeated no-PCM events that exceed a
   minimum duration threshold.
4. Prevent resubscribe if the meeting is finishing, the connection is destroyed,
   or the user has left the voice channel.

This makes the receiver resilient to corrupt frames or stale subscriptions
without restarting the meeting or dropping other users.

## Consequences

Positive:

- The pipeline can recover missing audio for a single speaker mid-meeting.
- We gain better observability for no-PCM events and last PCM timing.

Costs and risks:

- Extra resubscribe operations can cause a short gap for the affected speaker.
- More logging volume during error bursts.
- Resubscribe logic adds complexity that must be tested.

## Alternatives Considered

1. Subscribe per speaking segment using an after-silence end behavior and
   resubscribe on each speaking start event. This could reduce the chance of
   stale subscriptions but increases churn.
2. Switch to receiver `mode: "pcm"` and remove prism decoder usage.
3. Reconnect the entire voice connection when a single user fails. This is more
   disruptive and can interrupt all speakers.

## Notes

If resubscribe does not fully address the issue, revisit the alternatives above.
We should also evaluate whether voice state changes or SSRC churn should trigger
resubscribe events.
