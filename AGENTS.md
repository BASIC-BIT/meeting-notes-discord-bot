# AGENT ORIENTATION

## What this project is

- Discord bot that records voice meetings, transcribes them with OpenAI (gpt-4o-transcribe), generates notes with GPT-5.1, and posts results back to Discord.
- Supports auto-recording, meeting history in DynamoDB, context injection (server/channel/meeting), and a user-driven notes correction flow using LLMs.

## Tech stack

- Runtime: Node.js 20, TypeScript.
- Discord: discord.js v14, discord-api-types, @discordjs/voice for audio capture, @discordjs/opus, prism-media.
- AI: openai SDK; gpt-4o-transcribe for transcription; gpt-5.1 for cleanup/notes/corrections; DALL-E 3 for images.
- Storage: AWS DynamoDB (tables: Subscription, PaymentTransaction, AccessLogs, RecordingTranscript, AutoRecordSettings, ServerContext, ChannelContext, MeetingHistory).
- Infra: Terraform -> AWS ECS Fargate, ECR, CloudWatch logs; local Dynamo via docker-compose.
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
- Web server: `webserver.ts` (health check; optional Discord OAuth scaffolding).
- Frontend: `src/frontend/` (CRA boilerplate; currently unused).
- Dev/QA commands: `yarn start` (bot via nodemon+ts-node), `yarn frontend:start`, `yarn build`, `yarn serve`, `yarn test`, `yarn lint`, `yarn prettier`, `yarn terraform:init|plan|apply`.
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

- Central config: `src/services/configService.ts`; preferred source—avoid re-exporting secrets from `constants.ts`.
- Required always: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `OPENAI_API_KEY`.
- OAuth (optional): `ENABLE_OAUTH` (default true). If true, also require `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`, `OAUTH_SECRET`. If not using OAuth, set `ENABLE_OAUTH=false` (wired into Terraform env).
- OpenAI org/project IDs are optional (defaults empty).
- Other env defaults: `PORT` (3001), `NODE_ENV`, Dynamo local toggles via `USE_LOCAL_DYNAMODB`.

## Data model highlights (see `src/types/db.ts`)

- MeetingHistory: guildId, channelId_timestamp, meetingId, notes, transcript, context, attendees, duration, transcribe/generate flags, notesMessageId/channelId, notesVersion, notesLastEditedBy/At, meetingCreatorId, isAutoRecording.
- ServerContext / ChannelContext store prompt context.
- AutoRecordSettings enable record-all or per-channel auto-start.

## Frontend

- `src/frontend/` is CRA boilerplate, currently unused in main flow.

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

## Quick start (local)

- `yarn install`
- Copy `.env.example` to `.env`; set required tokens.
- `yarn dev` to start local Dynamo + init tables + bot.

## Testing / lint

- `npm run lint`, `npm run test` (Jest), `npm run build` (tsc).
