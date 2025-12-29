# Chronote

A Discord bot that records voice meetings, transcribes them with OpenAI, generates notes, and posts results back to Discord. It also supports billing, tagging, and a static frontend.

[Add the bot to your server](https://discord.com/oauth2/authorize?client_id=1278729036528619633)

## Commands

- `/startmeeting` – Begin recording the meeting (audio + chat logs).
- `/autorecord` – Configure auto-recording for a server/channel.
- `/context` – Manage prompt context.
- `/ask` – Ask questions over recent meeting history (guild scope by default).
- `/onboard` – Guided setup (context, auto-record, feature tour, upgrade CTA).

## Run locally

1. `yarn install`
2. Install FFMPEG (e.g., `choco install ffmpeg` on Windows).
3. Copy `.env.example` to `.env`; set required keys: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `OPENAI_API_KEY`. Optional: Stripe keys to enable checkout/portal endpoints; `USE_LOCAL_DYNAMODB=true` for local tables.
   - For mock portal data + OAuth bypass, set `MOCK_MODE=true` (no Discord/Dynamo required), or run `yarn start:mock` / `yarn dev:mock` to toggle mock mode without editing `.env`.
   - Deployed ECS uses **AWS Secrets Manager** for secrets (see `_infra/README.md`).
4. Start everything (local Dynamo + table init + bot): `yarn dev`
5. Frontend (Vite + Mantine) hot reload: `yarn frontend:dev`
6. Cloud workspace prep and mock-friendly env snippets: see `AGENTS.md` and `scripts/mock.env.example`

### DynamoDB local helpers

- `yarn docker:up` / `yarn docker:down` – start/stop local Dynamo + admin UI
- `yarn db:init` – create tables locally
- `yarn dev:clean` – wipe local Dynamo data and restart

## Quality gates

- Full local gate (auto-fix): `yarn run check` → eslint --fix, prettier --write, tests, backend build, Vite build.
- CI-safe: `yarn run check:ci` → lint:check, prettier:check, tests, backend build, Vite build.
- Individual: `yarn lint`, `yarn prettier`, `yarn test`, `yarn build`, `yarn build:web`.
- Code stats (ad-hoc): `yarn code:stats` (requires `scc` on PATH; CI prints this report on deploy). Use `.sccignore` to exclude paths from scc output. `whitelizard.txt` can be used to suppress known complexity offenders.

## Frontend

- Vite + React 19 + Mantine 8 UI under `src/frontend/`, builds to `build/frontend/`.
- Routing/data/state: TanStack Router + TanStack Query + tRPC + Zustand.
- Marketing site is public at `/`; the authenticated portal lives under `/portal/*`:
  - `/portal/select-server`
  - `/portal/server/:serverId/{library|ask|billing|settings}`
- Deployed via GitHub Actions to S3 + CloudFront (see `_infra/` and `.github/workflows/deploy.yml`).
- Static hosting variables: `FRONTEND_BUCKET`, `FRONTEND_DOMAIN` (optional), `FRONTEND_CERT_ARN` (when custom domain is set). Allow the SPA to call the API by setting `FRONTEND_ALLOWED_ORIGINS` (comma-separated, e.g., CloudFront domain). CloudFront distribution outputs are emitted by Terraform.
- API hosting: backend runs behind an ALB when `API_DOMAIN` is set (e.g., `api.chronote.gg`). Terraform sets a GitHub Actions env var `VITE_API_BASE_URL` so the frontend uses the API domain at build time. OAuth callback should be `https://api.<domain>/auth/discord/callback`.
- Local dev uses Vite proxying for `/auth`, `/user`, `/api`, and `/trpc` (tRPC).

## Backend / services

- Bot + API: Node 20, Express 5. API routes are modularized under `src/api/` (billing, guilds). New typed API surface is tRPC at `/trpc` (routers in `src/trpc/`).
- Voice capture: discord.js v14, @discordjs/voice/opus, prism-media.
- OpenAI: gpt-4o-transcribe for ASR, gpt-5.1 for notes/corrections, gpt-5-mini for live gate, DALL-E 3 for images.
- Billing: Stripe Checkout + Billing Portal; webhook handler persists GuildSubscription and PaymentTransaction in DynamoDB and handles payment_failed / subscription_deleted to downgrade appropriately (guild-scoped billing only).
- Sessions: Express sessions stored in DynamoDB `SessionTable` (TTL on `expiresAt`).
- Storage: DynamoDB tables include GuildSubscription, PaymentTransaction, StripeWebhookEventTable (idempotency with TTL), AccessLogs, RecordingTranscript, AutoRecordSettings, ServerContext, ChannelContext, MeetingHistory, AskConversationTable, SessionTable, InstallerTable, OnboardingStateTable. Transcripts and audio artifacts go to S3 (`TRANSCRIPTS_BUCKET`).

### Stripe webhook testing (local)

1. Install the Stripe CLI and authenticate: `stripe login`.
2. In one terminal, start the webhook forwarder and copy the webhook signing secret it prints:
   - `yarn stripe:listen`
   - Set `STRIPE_WEBHOOK_SECRET` to the secret value for local testing.
3. In another terminal, send fixture events:
   - `yarn stripe:trigger:checkout`
   - `yarn stripe:trigger:invoice-paid`
   - `yarn stripe:trigger:invoice-failed`
   - `yarn stripe:trigger:subscription-updated`
   - `yarn stripe:trigger:subscription-deleted`

Notes:

- CLI triggers emit fixture events. For end-to-end metadata (guild_id, discord_id), run a real checkout from the UI and complete the Stripe test flow.
- The webhook route expects a raw request body (`express.raw`) for signature verification, so it must be mounted before `express.json()` (already wired in `src/webserver.ts`).

## Infrastructure

- Terraform in `_infra/` provisions ECS/Fargate bot, Dynamo tables, transcripts bucket, SessionTable, and the static frontend (S3 + CloudFront with OAC, SPA fallback).
- When `API_DOMAIN` is set, Terraform also provisions an internet-facing ALB for the API (listener on 80/443) plus Route53 alias + ACM cert.
- Runtime secrets for ECS are stored in **AWS Secrets Manager** and referenced by the task definition (see `_infra/README.md`).
- Helpers: `yarn terraform:init | plan | apply`.
- IaC scanning: `yarn checkov` (Checkov) locally; also runs in CI.

### Observability (hosted)

- AMP (Amazon Managed Prometheus) and AMG (Amazon Managed Grafana) are provisioned by Terraform. AMG requires IAM Identity Center (AWS SSO) to be enabled in the account.
- **Manual Grafana service account token (one-time):**
  1. In the AWS console: Amazon Managed Grafana → open your workspace.
  2. In Grafana: _Administration → Service accounts_ → **New service account** (role: Admin) and create a token.
  3. Export `GRAFANA_API_KEY=<service account token>` (or set `TF_VAR_grafana_api_key`) before running `terraform apply`.
  4. Set `GRAFANA_URL` (or `TF_VAR_grafana_url`) to the AMG endpoint shown in the console (e.g., `https://g-xxxx.grafana-workspace.us-east-1.amazonaws.com/`).
  5. The Grafana provider uses that URL + token to create the Prometheus data source pointing at AMP and a starter dashboard.

### Observability (local)

- `yarn observability:up` → starts local Prometheus (scrapes `host.docker.internal:3001/metrics`) and Grafana on :3000 with a pre-provisioned Prom datasource.
- `yarn observability:down` to stop.

## Code complexity with scc and lizard

Setup:

- Install scc (Windows): `choco install scc` (run in an elevated shell).
- Install lizard: `python -m pip install lizard`
- Run: `yarn code:stats`

## Contribution

Contributions are welcome! Open an issue or PR with ideas or improvements.

## License

AGPL-3.0-or-later.
