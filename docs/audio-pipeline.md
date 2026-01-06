# Audio Pipeline

This document summarizes how audio flows through the bot, which files we create,
and how we recover when mixing fails.

## Audio flow overview

1. Discord voice receiver yields Opus packets for each user.
2. We decode Opus to PCM and write it to:
   - The live combined MP3 stream.
   - Per-snippet PCM files for transcription and post processing.
3. At meeting end we attempt to produce a mixed MP3 from per-snippet segments.
4. If mixing fails, we fall back to a stitched MP3, then to the combined MP3.

## File types and naming

All files live under `tmp/meetings/m/<meetingId>/`.

### Live combined MP3

- Path: `recording.mp3`
- Produced continuously during the meeting by piping decoded PCM into ffmpeg.
- Used when mixing and stitching are unavailable.

### Per-snippet PCM segments

- Path: `s/s_<sequence>.pcm`
- Each segment corresponds to a single speaker snippet.
- Used for transcription, mixing, and stitching.

### Mixed MP3

- Path: `recording_mixed.mp3`
- Built at meeting end with a single ffmpeg command that applies per-segment
  delay and `amix` to align speakers on the timeline.
- Preferred output if it succeeds.

### Stitched MP3

- Path: `recording_stitched.mp3`
- Built by ordering segment PCM files by timestamp, inserting silence for gaps,
  then encoding the resulting PCM to MP3.
- Used only if mixing fails.

### Split chunks for uploads

- Path: `c/c_<index>.mp3`
- Created only when an output MP3 exceeds the Discord upload limit.

## Cleanup

- We delete temporary files after uploads and when the meeting finishes.
- The meeting temp directory is removed at the end of the flow.
