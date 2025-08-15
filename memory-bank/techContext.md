# Tech Context: Meeting Notes Discord Bot

## 1. Core Technologies

- **Programming Language:** TypeScript (compiled to JavaScript for Node.js)
- **Runtime Environment:** Node.js (v18.x specified in `package.json` and `Dockerfile`)
- **Package Manager:** Yarn (v1.22.22 specified in `package.json`)
- **Discord Interaction:** `discord.js` (v14.15.3)
- **Voice Handling:**
  - `@discordjs/voice` (v0.17.0) for receiving and managing voice connections.
  - `@discordjs/opus` (v0.9.0) and `libsodium-wrappers` (v0.7.15) for Opus audio encoding/decoding.
  - `prism-media` (v1.3.5) for Opus stream decoding.
- **Audio Processing:**
  - `fluent-ffmpeg` (v2.1.3) with `ffmpeg-static` (v5.2.0) for audio format conversion (PCM to WAV for transcription, combining snippets to MP3) and manipulation (splitting large MP3s).
- **AI & Machine Learning:**
  - `openai` (v4.57.0) for interacting with OpenAI APIs:
    - Whisper-1 for audio transcription.
    - GPT-4o for generating summaries, notes, to-do lists, and image prompts.
    - DALL-E 3 for image generation.
- **Web Server (Optional/Auxiliary):**
  - `express` (v4.19.2) for the basic web server.
  - `express-session` (v1.18.1) for session management.
  - `passport` (v0.7.0) and `passport-discord` (v0.1.4) for Discord OAuth.
- **Resiliency & Rate Limiting (for OpenAI API):**
  - `cockatiel` (v3.2.1) for retry, circuit breaker patterns.
  - `bottleneck` (v2.19.5) for rate limiting.
- **Configuration:** `dotenv` (v16.4.5) for environment variable management.
- **Date/Time Utilities:** `date-fns` (v3.6.0) for date formatting.

## 2. Development Setup & Tooling

- **Build System:** `tsc` (TypeScript Compiler) as defined in `package.json` scripts (`"build": "tsc"`).
- **Development Server:** `nodemon` (v3.1.4) with `ts-node` (v10.9.2) for live reloading during development (`"start": "nodemon --exec ts-node src/index.ts"`).
- **Linting:** ESLint (`@eslint/js`, `typescript-eslint`) configured in `eslint.config.mjs`.
  - Uses `eslint-config-prettier` to avoid conflicts with Prettier.
- **Formatting:** Prettier (`prettier`) configured in `.prettierrc` (currently empty, so default Prettier settings apply).
- **Testing:**
  - Jest (`jest`, `@jest/globals`, `ts-jest`) as the testing framework.
  - Configuration in `jest.config.ts`.
  - `babel.config.js` is present, likely to support Jest transformations.
  - Frontend tests use `@testing-library/react`.
- **Version Control:** Git (implied by `.gitignore` and GitHub workflow).
- **Frontend (Create React App based):**
  - `react` (v18.3.1), `react-dom` (v18.3.1)
  - `react-scripts` (v5.0.1) for managing the frontend build, development, and testing.
  - Standard CRA setup files like `public/index.html`, `src/frontend/App.tsx`, etc.

## 3. Technical Constraints & Considerations

- **Discord API Limits:** Subject to Discord API rate limits for bot actions.
- **OpenAI API Limits & Costs:** Usage of Whisper, GPT, and DALL-E models is subject to OpenAI's pricing, rate limits, and usage policies. The application implements `cockatiel` and `bottleneck` to manage this.
- **FFmpeg Dependency:** Requires FFmpeg to be installed in the execution environment (handled in `Dockerfile`).
- **File System Usage:** The bot creates temporary files for audio processing (PCM, WAV, MP3 chunks). Proper cleanup is essential (`src/util.ts` provides helpers).
- **Maximum File Sizes:** Discord has upload limits (around 25MB), which the bot handles by splitting large audio files (`MAX_DISCORD_UPLOAD_SIZE` in `constants.ts`).
- **In-Memory State:** Active meeting data is stored in memory, which means it's lost if the bot restarts. This is a scalability and resilience constraint for the current implementation.
- **Single Instance Processing:** The current design seems to process meetings within a single Node.js instance.
- **Maximum Meeting Duration:** A hardcoded limit of 2 hours (`MAXIMUM_MEETING_DURATION` in `constants.ts`).

## 4. Dependencies & Libraries (Key Ones)

- **Core Runtime:** `typescript`, `ts-node`, `node`
- **Discord:** `discord.js`, `@discordjs/voice`, `@discordjs/opus`, `libsodium-wrappers`, `discord-api-types`
- **Audio:** `fluent-ffmpeg`, `ffmpeg-static`, `prism-media`
- **AI:** `openai`
- **Web Framework:** `express`, `express-session`, `passport`, `passport-discord`
- **Utilities:** `dotenv`, `cockatiel`, `bottleneck`, `date-fns`
- **Dev/Build:** `nodemon`, `eslint`, `prettier`, `jest`, `babel`
- **AWS SDK (for `db.ts` and IaC):** `@aws-sdk/client-dynamodb`, `@aws-sdk/util-dynamodb`

## 5. Tool Usage Patterns

- **Terraform:** Used for provisioning and managing AWS infrastructure (`_infra/main.tf`, `_infra_state_mgmt/state_mgmt.tf`). This includes ECR repositories, ECS clusters/services, VPCs, subnets, S3 buckets for Terraform state, and DynamoDB tables for state locking.
- **Docker:** Used to containerize the application for deployment (`Dockerfile`). The image is built and pushed to AWS ECR.
- **GitHub Actions:** Used for CI/CD (`.github/workflows/deploy.yml`).
  - Triggered on pushes to the `master` branch.
  - Builds the Docker image.
  - Pushes the image to AWS ECR.
  - Updates the AWS ECS service to deploy the new image version by registering a new task definition.
- **FFmpeg:** Invoked programmatically via `fluent-ffmpeg` for:
  - Converting raw PCM audio snippets to WAV format for OpenAI Whisper.
  - Combining all PCM audio data from a meeting into a single MP3 file.
  - Splitting the final MP3 file into smaller chunks if it exceeds Discord's upload limits.
- **OpenAI API:**
  - `audio.transcriptions.create` (Whisper) for transcribing WAV audio files.
  - `chat.completions.create` (GPT models) for generating summaries, notes, to-do lists, and image prompts based on transcriptions.
  - `images.generate` (DALL-E) for creating images from generated prompts.
- **AWS SDK:**
  - Used by Terraform for provisioning.
  - `db.ts` uses it for potential DynamoDB interactions (though not actively used in the core meeting flow shown).

## 6. Frontend Context

- The project includes a React frontend located in `src/frontend/`.
- It's a standard Create React App (CRA) setup.
- Files like `App.tsx`, `index.tsx`, `App.css` define a basic React application.
- `package.json` includes scripts for starting, building, and testing the frontend (`frontend:start`, `frontend:build`, `frontend:test`).
- The `Dockerfile` does **not** explicitly build or serve this frontend as part of the main bot application. The `EXPOSE 3000` and `CMD ["npx", "yarn", "serve"]` (which runs `node dist/index.js`) suggest the Docker container is primarily for the backend bot.
- The `webserver.ts` listens on port 3001 (or `process.env.PORT`).
- The purpose of this frontend in the current bot architecture is likely for OAuth callbacks (`/auth/discord/callback`) or a potential future admin/user dashboard, but it's not directly integrated into the bot's meeting recording service flow.
