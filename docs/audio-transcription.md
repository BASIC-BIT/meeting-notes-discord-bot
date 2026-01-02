# Audio Transcription Flow

## Overview

Chronote records voice audio, builds per speaker snippets, and runs transcription in two passes. A fast pass gives early results during short pauses, while the slow pass finalizes a snippet after longer silence or a max snippet wall. The system keeps longer contiguous snippets to preserve accuracy, then uses optional coalescing to merge fast and slow outputs when premium is enabled.

## Product decisions

- Dual pass transcription: Fast transcriptions are for timely feedback. Slow transcriptions are the authoritative final output.
- Minimum snippet size: Short snippets are skipped to avoid sending noise or partial audio to transcription.
- Max snippet wall: A snippet is forced to finalize when it grows too long, even if a speaker never fully pauses.
- Interjection ordering: Optional interjection splitting finalizes paused snippets when another speaker interjects, so ordering is closer to the actual conversation.

## Technical decisions

- Snippets are per speaker and store raw PCM chunks, a start timestamp, and recent fast transcript metadata.
- Fast transcription is triggered after the fast silence threshold and only when snippet duration exceeds the minimum snippet seconds.
- Slow transcription finalizes after the slow silence threshold or after the max snippet wall.
- Fast only finalization can skip the slow pass if the latest fast transcript covers the full snippet byte length.
- Interjection splitting checks for a validated interjection snippet before finalizing other paused snippets.

## Langfuse audio attachments

When Langfuse tracing is enabled, each transcription snippet uploads an audio attachment to the trace for debugging.

- The attachment is always an MP3 generated from the snippet WAV file.
- Encoding is VBR quality 6, mono, 16 kHz to keep size down while staying intelligible.
- Attachments are skipped if the MP3 exceeds 8 MB.
- The MP3 file is temporary and is deleted after upload.
- The compressed MP3 is for observability only and does not affect transcription quality.

## Config keys

All values are set via the config system and can be overridden at the global or server level.

- `transcription.fastSilenceMs`
- `transcription.slowSilenceMs`
- `transcription.minSnippetSeconds`
- `transcription.maxSnippetMs`
- `transcription.fastFinalization.enabled`
- `transcription.interjection.enabled`
- `transcription.interjection.minSpeakerSeconds`

## Interjection behavior

Interjection splitting is guarded to avoid fragmenting snippets on noise.

- Interjection splitting is disabled by default.
- The interjector must produce a snippet that meets `transcription.interjection.minSpeakerSeconds`.
- Only paused speakers are finalized. Active speakers are not split.
- Paused snippets are only finalized if their most recent pause began within `transcription.slowSilenceMs` of the interjection start.

## Cleanup behavior

Transcription cleanup runs on the compiled transcript text. The structured transcript JSON stores per snippet text without cleanup. This keeps cleanup optional and limits the risk of rewriting per speaker segments during the capture phase.
