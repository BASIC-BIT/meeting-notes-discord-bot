# Live Voice Agent V1 (Text Gate + TTS)

## Scope for Tonight

- Add text-gated TTS voice replies while recording meetings.
- Hardcode voice `alloy`.
- No budgets/cooldowns; single 2s silence threshold.
- Use existing transcript snippets; do not ship realtime WS yet.

## Integration Steps

1. Lower `SILENCE_THRESHOLD` to 2000 ms globally.
2. Add `LIVE_VOICE_MODE` env toggle (`off | tts_gate`, default `off`) plus model/voice overrides: `LIVE_VOICE_GATE_MODEL` (default `gpt-5-mini`), `LIVE_VOICE_TTS_MODEL` (default `gpt-4o-mini-tts`), and `LIVE_VOICE_TTS_VOICE` (default `alloy`).
3. Create `src/liveVoice.ts`:
   - `shouldSpeak(meeting, context): Promise<{ respond: boolean; reply: string }>` using gate model from config with strict JSON guard (always emit JSON; respond:false+reply:"" when silent).
   - `streamTtsToDiscord(meeting, reply: string): Promise<void>` that streams `gpt-4o-mini-tts` PCM -> ffmpeg resample -> opus encode -> Discord audio player.
   - `maybeRespondLive(meeting, segment)` orchestrates gate + playback; skips if someone currently speaking.
4. Meeting wiring:
   - Extend `MeetingData` with `liveAudioPlayer?: AudioPlayer` and `liveVoiceEnabled?: boolean`.
   - Initialize `liveAudioPlayer` and subscribe to connection in `initializeMeeting` when `LIVE_VOICE_MODE === "tts_gate"`.
5. Hook point: in `startProcessingSnippet` (after `transcribeSnippet` resolves), call `maybeRespondLive` with `{ userId, text, timestamp }` when live mode is on.
6. Telemetry/logs: log when we speak (timestamp, ms duration) and gate decisions for tuning.

## Follow-Ups (not tonight)

- Cooldown/budget knobs; per-channel voice selection.
- Realtime WS voice-to-voice mode.
- Simple PCM mixer to avoid interlaced multi-user streams in recordings.
- Consider adding a `reason` field in gate JSON to reduce empty outputs and aid debugging.
- Gate uses `max_completion_tokens` (env `LIVE_VOICE_GATE_MAX_OUTPUT_TOKENS`, default 256); no model fallback.
