# AGENT ORIENTATION

## What this project is

- Discord bot that records voice meetings, transcribes them with OpenAI (gpt-4o-transcribe), generates notes with GPT-5.1, and posts results back to Discord.
- Supports auto-recording, meeting history in DynamoDB, context injection (server/channel/meeting), and a user-driven notes correction flow using LLMs.

## Tech stack

- Runtime: Node.js 20, TypeScript.
- Discord: discord.js v14, discord-api-types, @discordjs/voice for audio capture, @discordjs/opus, prism-media.
- AI: openai SDK; gpt-4o-transcribe for transcription; gpt-5.1 for cleanup/notes/corrections; gpt-5-mini for live gate; DALL-E 3 for images.
- Storage: AWS DynamoDB (tables: GuildSubscription, PaymentTransaction, AccessLogs, RecordingTranscript, AutoRecordSettings, ServerContext, ChannelContext, MeetingHistory, SessionTable), S3 for transcripts/audio.
- Infra: Terraform -> AWS ECS Fargate, ECR, CloudWatch logs; static frontend on S3 + CloudFront with OAC; local Dynamo via docker-compose.
- IaC scanning: Checkov GitHub Action (`.github/workflows/checkov.yml`) scans `_infra/` on PRs and main pushes. Local: `npm run checkov` (uses `uvx --from checkov checkov`; install uv first: https://docs.astral.sh/uv/).
- Known/suppressed infra choices:
  - Public subnets + public ECS IPs retained temporarily to avoid NAT Gateway cost (see checkov skips on CKV_AWS_130/333 with rationale in `_infra/main.tf`).
  - VPC flow logs enabled to CloudWatch (365d, KMS `app_general`).
  - ECR hardened (immutable tags, scan on push, KMS).
  - CloudWatch logs KMS + 365d, tightened SG egress (443 + DNS), split ECS execution/task roles, DynamoDB tables use PITR + KMS (app_general), default SG locked down.
- Tooling: Jest, ESLint, Prettier, Husky, lint-staged; ts-node/nodemon for dev.

## Key flows (server code in `src/`)

- Entry: `index.ts` -> `setupBot()` and `setupWebServer()`.
- Bot interactions: `src/bot.ts`
  - Slash commands: `/startmeeting`, `/autorecord`, `/context`.
  - Buttons: end meeting, generate image, suggest correction.
  - Auto-record on voice join if configured.
- Web server: `webserver.ts` (health check; optional Discord OAuth scaffolding). API routes are modularized under `src/api/` (billing, guilds) and share services with bot commands (ask/context/autorecord/billing).
- Frontend: `src/frontend/` (Vite + React 19), builds to `build/frontend/`, deployed to S3/CloudFront. Express only handles API/health; static assets served via CDN.
- Dev/QA commands: `yarn start` (bot via nodemon+ts-node), `yarn dev` (starts local Dynamo + init + bot), `yarn frontend:dev`, `yarn build`, `yarn build:web`, `yarn build:all`, `yarn test`, `yarn lint`, `yarn prettier`, `yarn terraform:init|plan|apply`.
- Meeting lifecycle: `meetings.ts`, `commands/startMeeting.ts`, `commands/endMeeting.ts`.
  - Records audio, chat log, attendance; splits audio; transcribes; generates notes; saves MeetingHistory (with transcript, notes versioning).
- Transcription & notes: `transcription.ts`
  - Builds context from server/channel/meeting and recent history (`services/contextService.ts`).
  - GPT prompts tuned for cleanup, notes, and optional image generation.
- Notes correction flow: `commands/notesCorrections.ts`
  - “Suggest correction” button → modal (single textarea).
  - Fetches saved notes + transcript from DB, calls GPT-4o with a “minimal edits, do not copy transcript” prompt, shows a compact line diff, requires approval (meeting creator or ManageChannels if auto-record), updates embed + MeetingHistory and bumps version/last editor.
- Context management: `commands/context.ts` writes/reads ServerContext and ChannelContext.
- Meeting history persistence: `commands/saveMeetingHistory.ts`, `db.ts` helpers.
- Web server: `webserver.ts` (health check, optional Discord OAuth scaffolding).

## Configuration & env

- Central config: `src/services/configService.ts`; preferred source (avoid re-exporting secrets from `constants.ts`).
- Required always: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `OPENAI_API_KEY`.
- OAuth (optional): `ENABLE_OAUTH` (default true). If true, also require `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`, `OAUTH_SECRET`. If not using OAuth, set `ENABLE_OAUTH=false` (wired into Terraform env).
- Production OAuth should use the API domain callback (e.g., `https://api.chronote.gg/auth/discord/callback`). When `API_DOMAIN` is set in Terraform, the backend is behind an ALB and the frontend build uses `VITE_API_BASE_URL` from GitHub Actions env vars.
- OpenAI org/project IDs are optional (defaults empty).
- Other env defaults: `PORT` (3001), `NODE_ENV`, Dynamo local toggles via `USE_LOCAL_DYNAMODB`.
- Cloud dev bootstrap: run `./scripts/setup-cloud-dev.sh` to sync uv, install scc into `.bin/`, install lizard into `.venv/bin/`, and install Playwright browsers (no flags needed). Add `.bin` and `.venv/bin` to `PATH` for `yarn code:stats`.
- Mock-friendly env file: copy `scripts/mock.env.example` to `.env` or source it directly (`set -a; source scripts/mock.env.example; set +a`) instead of exporting many vars manually. The file keeps mock mode enabled, disables OAuth, points at local DynamoDB, and supplies dummy tokens.
- Transcript storage: set `TRANSCRIPTS_BUCKET` (required for S3 uploads), optional `TRANSCRIPTS_PREFIX`, `AWS_REGION` (defaults to `us-east-1`).

## Data model highlights (see `src/types/db.ts`)

- MeetingHistory: guildId, channelId_timestamp, meetingId, notes, `transcriptS3Key`, context, attendees, duration, transcribe/generate flags, notesMessageId/channelId, notesVersion, notesLastEditedBy/At, meetingCreatorId, isAutoRecording, `suggestionsHistory`, `notesHistory`.
- ServerContext / ChannelContext store prompt context.
- AutoRecordSettings enable record-all or per-channel auto-start.

## Frontend

- Vite + React 19 lives in `src/frontend/`; production build is static assets in `build/frontend/` served via S3/CloudFront (see deploy workflow). Use `yarn frontend:dev` for local HMR.

## Infra (Terraform)

- Variables (tfvars.example): Discord IDs/tokens, OpenAI keys, OAuth secrets, ENABLE_OAUTH (false by default in example), AWS/GitHub tokens.
- ECS task environment passes all relevant vars from Terraform; OpenAI org/project optional; OAuth vars included but can be blank if disabled.

## Known nuances / gotchas

- Token leaks: don’t reintroduce secret re-exports in `constants.ts`; use `configService`.
- Discord interaction timing: modal/button handlers must reply within 3s; correction flow already uses direct replies.
- Diff output is intentionally minimal (line diff, capped length); LLM output is stripped of code fences to avoid code-block embeds.
- Meeting duration capped at 2h (`MAXIMUM_MEETING_DURATION`).
- Auto-record will end meeting if channel empties.
- **Current outbound network rules (ECS service SG)**: temporarily allowing all egress (UDP/TCP any port) for Discord voice debugging. Previously it was limited to TCP 443 and DNS (53) only. Remember to tighten this once voice is stable and update this note.
- Avoid `in`/`instanceof`/`typeof` hedging for core platform APIs; we target a known Node/SDK set. Prefer simple, direct calls with minimal branching.
- Comment hygiene: don’t leave transient or change-log style comments (e.g., “SDK v3 exposes transformToString”). Use comments only to clarify non-obvious logic, constraints, or intent.
- Writing style: do not use em dashes in copy/docs/comments; prefer commas, parentheses, or hyphens.
- README should stay high signal for users, avoid listing research outcomes like query parameter details. Put rationale or research notes in planning documentation files instead.
- “Remember that …” shorthand: when the user says “remember that <rule>”, add it to AGENTS.md under the relevant section as a standing rule.
- Do not suppress runtime warnings by monkey-patching globals (e.g., overriding console.error). Fix the underlying issue or accept the warning; never silence it via code hacks.
- Stripe webhook parsing: keep a single `express.raw({ type: "application/json" })` at app-level in `webserver.ts`; do not add per-route raw parsers elsewhere.
- React tests: when a test triggers state updates (e.g., data-fetching effects), wrap renders/updates in `act` (from `react`/RTL helpers) to avoid act warnings instead of silencing console errors.

## Quick start (local)

- `yarn install`
- Copy `.env.example` to `.env`; set required tokens.
- `yarn dev` to start local Dynamo + init tables + bot.

## Worktrees (standard flow)

- Use `scripts/new-worktree.ps1` from the main repo to create a worktree and branch, and copy the main `.env`.
  - Example: `.\scripts\new-worktree.ps1 -Branch feature-chat-tts`
  - If you run the script from a non-main worktree, pass `-SourceEnv ..\meeting-notes-discord-bot\.env`.
  - Default worktree path is `..\meeting-notes-discord-bot-<branch>`.
- Create a dedicated Discord text channel and voice channel for the branch, then use those for testing.
- If `.env` changes on main, re-run the script or copy `.env` into the worktree.

## Checks

- Local full gate: `yarn run check` (lint --fix, prettier --write, test, build:all, code:stats).
- CI-safe local gate: `yarn run check:ci` (lint:check, prettier:check, test, build, code:stats). Avoid `yarn check` (built-in Yarn integrity command).
- CI also runs: `yarn test:e2e` and `yarn checkov` (see `.github/workflows/ci.yml`).

Why each check exists:

- Lint (ESLint) catches common errors and keeps code quality consistent. Docs: https://eslint.org/docs/latest/use/command-line-interface
- Format (Prettier) enforces a consistent style and removes formatting churn. Docs: https://prettier.io/docs/cli
- Tests and coverage (Jest) protect behavior and enforce coverage thresholds defined in `jest.config.ts`. Current global thresholds: statements 30%, branches 60%, functions 40%, lines 30%. Docs: https://jestjs.io/docs/29.7/configuration
- Build (TypeScript + Vite) validates type safety and ensures the frontend bundles. Docs: https://www.typescriptlang.org/docs/handbook/compiler-options.html and https://vite.dev/guide/
- E2E (Playwright) validates core user flows against the UI. Docs: https://playwright.dev/docs/running-tests
- Code stats and complexity (scc + lizard) keep size and complexity visible in CI. Lizard uses its default warning thresholds (CCN > 15, length > 1000, nloc > 1000000, parameter_count > 100). Use `.sccignore` for scc exclusions and `whitelizard.txt` to suppress known complexity offenders. Docs: https://github.com/boyter/scc and https://github.com/terryyin/lizard
- IaC scan (Checkov via uvx) catches Terraform misconfigurations. Docs: https://www.checkov.io/2.Basics/CLI%20Command%20Reference.html and https://docs.astral.sh/uv/concepts/tools/

Coverage guidance:

- Prefer adding tests over coverage ignores.
- If a coverage ignore is unavoidable, use c8 ignore directives with a short justification comment.
- After coverage improvements or coverage scope changes, round each threshold down to the nearest 10 and keep it in sync with `jest.config.ts`. Do not lower a threshold below its pre-PR value unless the coverage scope meaningfully expands, in which case reset to the new rounded baseline and call it out in the PR.
## Non-idiomatic typing

If you find yourself using keywords like `tyepof`, `as`, etc. you should then pause and think about how you can improve that code. This might involve a web search to go search online for the idiomatic way of using the library/framework/etc. Look for a way that leverages typescript best practices, such as type narrowing, to write clean maintainable code

