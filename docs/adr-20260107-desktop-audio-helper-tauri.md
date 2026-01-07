# ADR-20260107: Windows Desktop Audio Helper (Tauri)

Status: Proposed  
Date: 2026-01-07  
Owners: Desktop helper, Voice/Transcription

## Context

- Discord does not expose a supported way for bots to capture Go Live audio, so we need a client-side path to supply mixed system audio to the existing meeting pipeline.
- Windows offers process-scoped loopback capture (include or exclude a process tree) starting with build 20348, which lets us grab a game or omit Discord audio without virtual cables. citeturn0search1
- We want fast iteration on Windows first, but we need a future path to macOS/Linux.
- Shipping updates safely and silently is critical; the Tauri updater plugin mandates signed artifacts and a public key baked into `tauri.conf.json`. citeturn0search0
- For user identity, Discord OAuth with Authorization Code + PKCE and a loopback redirect keeps the helper public-client compliant; we will retain a pairing token fallback for air‑gapped cases. citeturn0search2

## Decision

1. Build the helper in Tauri v2 on Windows first (Rust core, minimal web UI).
2. Audio capture phases:
   - MVP: system mix loopback capture (default).
   - Phase 2: process include mode to capture only the chosen app; process exclude mode to drop Discord if desired. Both rely on Application Loopback API on build 20348+. citeturn0search1
3. Transport: stream Opus frames to the existing ingest endpoint; keep PCM as a debug fallback.
4. Auth: primary is Discord OAuth (Code + PKCE, loopback redirect on localhost); fallback is a short‑lived pairing token issued by the bot. citeturn0search2
5. Updates: use the official Tauri updater plugin with static JSON hosted on S3, `createUpdaterArtifacts=true`, baked public key, and HTTPS endpoints that include `{{target}}` and `{{arch}}`. citeturn0search0
6. Installer: Windows MSI (and optionally NSIS) artifacts produced by the updater pipeline; start with `installMode: passive`. citeturn0search0
7. Telemetry: minimal event posts to our backend (start, stop, version, capture mode, errors); no third-party SDK initially.
8. Cross-platform: revisit macOS/Linux after Windows GA; keep capture core isolated to swap implementations per OS.

## Consequences

Positive:

- Users get a one-click helper that can stream game/system audio into meetings without Discord client mods.
- Process include/exclude allows removing Discord audio when possible, reducing transcript contamination.
- Signed, auto-updating builds reduce manual support overhead. citeturn0search0
- OAuth mapping gives us a trusted user identity and permissions alignment with the bot. citeturn0search2

Costs and risks:

- Losing the Tauri updater private key would strand existing installs; key management must be hardened. citeturn0search0
- Process-based capture yields silence if the target process stops rendering audio; UX needs clear feedback. citeturn0search1
- Windows-only MVP delays value for macOS/Linux users.
- Loopback redirects must be allowed by Discord OAuth settings; we need to validate in staging. citeturn0search2

## Alternatives Considered

1. Electron + node WASAPI modules: broader plugin ecosystem but larger runtime and more attack surface.
2. Pure Rust + WinUI: smaller footprint, harder to extend cross-platform and slower UI iteration.
3. OBS/virtual audio cable requirement: higher user friction and support load.
4. Stay bot-only: cannot capture Go Live audio, does not solve the problem.

## Notes

- Default to system mix until process include/exclude is proven stable.
- Require Windows 10 build 20348+ in the installer check. citeturn0search1
- Keep pairing token path alive for environments that block OAuth loopback.
- Store the updater private key in dedicated secure storage and document rotation. citeturn0search0
