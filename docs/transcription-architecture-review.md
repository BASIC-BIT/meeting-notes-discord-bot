# Transcription architecture review and scale path

See `docs/audio-pipeline.md` for the audio file inventory and fallback behavior.

## Goals

- Preserve spoken content while reducing prompt or glossary echoes.
- Keep live transcription responsive while meeting-end cleanup stays predictable.
- Capture enough observability to explain slowdowns and CPU spikes.

## Current pipeline summary

- Voice is captured per speaker, chunked into snippets, and transcribed as fast and slow variants.
- Transcription calls are rate limited and serialized by a Bottleneck limiter, then retried by Cockatiel policies.
- End meeting waits for pending transcriptions, generates notes, uploads artifacts, and cleans up audio.

## Observed pain points

- Prompt or glossary echoes can be misread as real transcription output.
- Short snippets can be discarded without enough context in logs.
- Transcription backlog can delay end meeting, especially when the queue builds up.
- CPU spikes likely correlate with ffmpeg work for mixing and splitting audio.

## Near-term changes (this changeset)

- Guard flags for prompt like output and glossary term only output, plus structured logs and Langfuse metadata.
- Background Langfuse audio attachments to remove ffmpeg from the hot transcription path.
- Better end meeting tracing, with step durations recorded in Langfuse and logs.
- Modest concurrency increase for transcription to reduce backlog.

## Observability additions

- Meeting end steps are traced with duration metadata in Langfuse, including audio mixing, splitting, transcription waits, notes generation, and uploads.
- Transcription guard warnings include audio duration, bytes, and similarity metrics for debugging.
- Minimum snippet drops include meeting and duration context.

## Scale path ideas

- Move audio mixing and chunk splitting into a worker or Lambda to decouple from the bot CPU budget.
- Queue transcription jobs with a bounded worker pool and persist work state for recovery.
- Add a dedicated attachment queue for Langfuse media with a hard concurrency cap.
- Consider moving artifact uploads and summary generation to a background job if latency is more important than immediacy.

## Open questions

- Where should heavy ffmpeg work live long term, ECS task or worker queue.
- Should we store audio segments in S3 as we go to support reprocessing.
- What response time is acceptable between end meeting and summary delivery.
