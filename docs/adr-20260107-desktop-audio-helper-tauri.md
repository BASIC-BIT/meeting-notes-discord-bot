# ADR-20260107: Windows Desktop Audio Helper (Tauri)

Status: Proposed  
Date: 2026-01-07  
Owners: Desktop helper, Voice/Transcription

## Context

- Discord does not expose a supported way for bots to capture Go Live audio, so we need a client-side path to supply mixed system audio to the existing meeting pipeline.
- Windows offers process-scoped loopback capture (include or exclude a process tree) starting with build 20348, which lets us grab a game or omit Discord audio without virtual cables.
- We want fast iteration on Windows first, but we need a future path to macOS/Linux.
- Shipping updates safely and silently is critical; the Tauri updater plugin mandates signed artifacts and a public key baked into `tauri.conf.json`.
- For user identity, Discord OAuth with Authorization Code + PKCE and a loopback redirect keeps the helper public-client compliant; we will retain a pairing token fallback for air‑gapped cases.

## Decision

1. Build the helper in Tauri v2 on Windows first (Rust core, minimal web UI).
2. Audio capture phases:
   - MVP: system mix loopback capture (default).
   - Phase 2: process include mode to capture only the chosen app; process exclude mode to drop Discord if desired. Both rely on Application Loopback API on build 20348+.
3. Transport: stream Opus frames to the existing ingest endpoint; keep PCM as a debug fallback.
4. Auth: primary is Discord OAuth (Code + PKCE, loopback redirect on localhost); fallback is a short‑lived pairing token issued by the bot.
5. Updates: use the official Tauri updater plugin with static JSON hosted on S3, `createUpdaterArtifacts=true`, baked public key, and HTTPS endpoints that include `{{target}}` and `{{arch}}`.
6. Installer: Windows MSI (and optionally NSIS) artifacts produced by the updater pipeline; start with `installMode: passive`.
7. Telemetry: minimal event posts to our backend (start, stop, version, capture mode, errors); no third-party SDK initially.
8. Cross-platform: revisit macOS/Linux after Windows GA; keep capture core isolated to swap implementations per OS.

## Consequences

Positive:

- Users get a one-click helper that can stream game/system audio into meetings without Discord client mods.
- Process include/exclude allows removing Discord audio when possible, reducing transcript contamination.
- Signed, auto-updating builds reduce manual support overhead.
- OAuth mapping gives us a trusted user identity and permissions alignment with the bot.

Costs and risks:

- Losing the Tauri updater private key would strand existing installs; key management must be hardened.
- Process-based capture yields silence if the target process stops rendering audio; UX needs clear feedback.
- Windows-only MVP delays value for macOS/Linux users.
- Loopback redirects must be allowed by Discord OAuth settings; we need to validate in staging.

## Alternatives Considered

1. Electron + node WASAPI modules: broader plugin ecosystem but larger runtime and more attack surface.
2. Pure Rust + WinUI: smaller footprint, harder to extend cross-platform and slower UI iteration.
3. OBS/virtual audio cable requirement: higher user friction and support load.
4. Stay bot-only: cannot capture Go Live audio, does not solve the problem.

## Notes

- Default to system mix until process include/exclude is proven stable.
- Require Windows 10 build 20348+ in the installer check.
- Keep pairing token path alive for environments that block OAuth loopback.
- Store the updater private key in dedicated secure storage and document rotation.

## Addendum

- Tauri updater plugin requires Rust 1.77.2+ and signed artifacts. Losing the private key blocks future updates for existing installs, so key custody and backups are mandatory.
- Update delivery options: static JSON file or a dynamic update server. Static JSON is sufficient for early stages and can live in S3 behind HTTPS.
- Static JSON schema: include version, release notes, publish date, and per-platform entries with URL and signature. Keep the JSON stable because clients cache it.
- Updater endpoints can include template variables like {{target}}, {{arch}}, and {{current_version}}. TLS is enforced in production, and allowInsecure should stay dev only.
- Windows bundles: updater can emit MSI and NSIS installers plus .sig files. Use installMode "passive" as default; "quiet" cannot prompt for elevation and is not recommended for general users.
- Updater wiring: plugin must be registered in the Rust backend and imported in the frontend, then check, download, install, and relaunch on success.
- OAuth for desktop: use Authorization Code + PKCE with a loopback redirect like http://127.0.0.1:<port>/callback. Confirm Discord portal settings allow loopback redirects for public clients.
- Process loopback capture: include or exclude a process tree, but capture is silent if the target process is not rendering audio. Some games emit audio from helper processes, so selection should allow picking a tree or fall back to full system mix.
