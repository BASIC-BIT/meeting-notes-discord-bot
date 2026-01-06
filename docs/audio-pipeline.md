# Audio Pipeline

This document summarizes how audio flows through the bot, which files we create,
and how we recover when mixing fails.

## Audio flow overview

1. Discord voice receiver yields Opus packets for each user.
2. We decode Opus to PCM and write it to:
   - The live combined MP3 stream.
   - Per-speaker PCM tracks built at snippet boundaries.
3. At meeting end we attempt to produce a mixed MP3 from the speaker tracks.
4. If mixing fails or no usable speaker tracks exist, we fall back to the combined MP3.

## File types and naming

All files live under `tmp/meetings/m/<meetingId>/`.

### Live combined MP3

- Path: `recording.mp3`
- Produced continuously during the meeting by piping decoded PCM into ffmpeg.
- Used when mixing is unavailable.

### Per-speaker PCM tracks

- Path: `t/t_<userId>.pcm`
- Each track is a time aligned PCM stream for a single speaker.
- Used for meeting end mixing.

### Mixed MP3 (preferred)

- Path: `recording_mixed.mp3`
- Built at meeting end with a single ffmpeg `amix` across speaker tracks.
- Preferred output when at least one speaker track is present.

### Split chunks for uploads

- Path: `c/c_<index>.mp3`
- Created only when an output MP3 exceeds the Discord upload limit.

## Cleanup

- We delete temporary files after uploads and when the meeting finishes.
- The meeting temp directory is removed at the end of the flow.
