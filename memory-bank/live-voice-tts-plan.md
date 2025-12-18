# Live Voice Agent (Text Gate + TTS)

## Current Behavior

- Gate model decides **respond: true/false** from a small context window.
- Responder model generates the actual reply text.
- Optional looping “thinking cue” plays while the reply is generating.
- TTS streams into Discord voice and is mixed into the saved meeting recording.
- Bot replies are appended to the transcript only after successful playback.

## Config (Env)

- `LIVE_VOICE_MODE`: `off | tts_gate` (default `off`)
- Gate: `LIVE_VOICE_GATE_MODEL` (default `gpt-5-mini`), `LIVE_VOICE_GATE_MAX_OUTPUT_TOKENS` (default `256`)
- Responder: `LIVE_VOICE_RESPONDER_MODEL` (default `gpt-4o-mini`)
- TTS: `LIVE_VOICE_TTS_MODEL` (default `gpt-4o-mini-tts`), `LIVE_VOICE_TTS_VOICE` (default `alloy`)
- Thinking cue: `LIVE_VOICE_THINKING_CUE` (default `true`), `LIVE_VOICE_THINKING_CUE_INTERVAL_MS` (default `500`)

## Wiring

1. `SILENCE_THRESHOLD` is 2000ms globally.
2. Meeting init:
   - Joins voice with `selfMute: false` so audio playback is transmitted.
   - If `LIVE_VOICE_MODE=tts_gate`, creates an `AudioPlayer` and subscribes it to the voice connection.
3. After each snippet transcription, we call `maybeRespondLive(meeting, segment)`.
4. `maybeRespondLive`:
   - `shouldSpeak` (gate: strict JSON `{ "respond": boolean }`)
   - looping thinking cue (optional)
   - `generateReply` (responder: plain text)
   - `streamTtsToDiscord` (TTS + playback)
5. `streamTtsToDiscord`:
   - TTS -> PCM -> resample -> Opus -> Discord voice
   - tees the resampled PCM into `audioPassThrough` so it’s captured in the MP3
   - on successful playback completion, appends the bot’s line to `audioFiles` so it appears in transcripts

## Follow-Ups

- Cooldown/budget knobs; per-channel voices.
- Smarter overlap/turn-taking (queue/grace window/ducking).
- Real-time voice-to-voice (Realtime API).
- Fix human audio “interlacing” with a proper PCM mixer for overlapping speakers.
- Gate JSON improvements (optional `reason` field) and more robust model handling.
- Responder context strategy (running summary, pruning, retrieval) once core UX is solid.

## Product Direction: Meeting History Lookup (Where The Value Is)

### Why

- The “wow” factor isn’t the voice itself; it’s answering questions using deep context from **this meeting so far** + **past meetings** (notes + transcripts + decisions).
- Meetings: “What did we decide last time about X?”, “Who owns Y?”, “When did we agree to ship Z?”
- TTRPG: “What’s the NPC’s name?”, “What loot did we get?”, “What was the plan last session?”

### Phase 0: Better Context (No RAG Yet)

- Current meeting context: give responder a bigger window than the last few transcript lines (e.g., last few minutes or “transcript so far”).
- Recent meeting notes: pull a handful of `MeetingHistory.notes` for channel/guild and include them when the bot is explicitly asked a question.
- Defer the “optimal context strategy” (summaries, pruning, retrieval) until this proves useful.

### Phase 1: “Ask/Recall” Command (Immediate Utility)

- Add `/ask` or `/recall` to answer questions about prior meetings in chat.
- Default scope: current channel; optional flags to widen to entire guild.
- Response format: answer + sources (meeting date/id) so users can trust/verify.
- This is likely higher value than always-on voice for most servers (and less intrusive).

### Phase 2: Lightweight Agentic Retrieval (Still Minimal Infra)

- Tool-style workflow:
  1. list recent meetings (notes/context/participants)
  2. select relevant meetings
  3. fetch transcripts from S3 only if needed for detail
  4. answer with citations
- Avoid a vector DB initially by using notes as an index and only loading transcripts on demand.

### Phase 3: Real RAG / Vector Search (If Needed)

- Chunk transcripts + notes, embed, store vectors with metadata (guild/channel/timestamp/tags/meetingId).
- Add reranking + summarization of retrieved chunks.

### Tagging / “Meeting Type” Filtering

- Add per-meeting tags and/or a meeting “type” (meeting / ttrpg / casual / other).
- Start manual (meeting context or a `/tag` command); optionally add LLM-suggested tags/type post-meeting with user override.
- Needed because channel-based filtering won’t hold when business + TTRPG share the same channel/server.
