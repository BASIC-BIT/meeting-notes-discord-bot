# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord bot that records and transcribes meetings from Discord voice channels. The bot captures audio, chat logs, and generates AI-powered summaries, notes, and action items using OpenAI.

## Architecture

**Hybrid Application Structure:**

- **Discord Bot Backend** (`src/bot.ts`, `src/audio.ts`, `src/transcription.ts`) - Main bot logic
- **Web Server** (`src/webserver.ts`) - OAuth authentication and health checks
- **Commands** (`src/commands/`) - Discord slash commands for meeting control
- **Frontend** (`src/frontend/`) - Basic React app (minimal, mostly CRA template)
- **Infrastructure** (`_infra/`) - Terraform for AWS deployment

**Key Files:**

- `src/index.ts` - Entry point, initializes bot and web server
- `src/meetings.ts` - Core meeting management logic
- `src/db.ts` - DynamoDB database interactions
- `src/types/` - TypeScript type definitions

**Audio Processing Flow:**

1. Bot joins Discord voice channel via `/startmeeting`
2. Records audio using @discordjs/voice and ffmpeg
3. Transcribes with OpenAI API
4. Generates meeting artifacts (summaries, notes, todo lists)

## Development Commands

**Development:**

```bash
yarn start                 # Start bot with nodemon + ts-node
yarn frontend:start        # Start React dev server (port 3000)
```

**Building:**

```bash
yarn build                 # Compile TypeScript to dist/
yarn frontend:build        # Build React for production
yarn serve                 # Run compiled bot
```

**Quality Assurance:**

```bash
yarn test                  # Run Jest tests
yarn lint                  # ESLint with auto-fix
yarn prettier              # Format code
```

**Infrastructure:**

```bash
yarn terraform:init       # Initialize Terraform
yarn terraform:plan       # Plan infrastructure changes
yarn terraform:apply      # Deploy to AWS
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Install FFmpeg (`choco install ffmpeg` on Windows)
3. Required environment variables:
   - `DISCORD_BOT_TOKEN` - Discord bot token
   - `DISCORD_CLIENT_ID` - Discord application ID
   - `DISCORD_CLIENT_SECRET` - Discord OAuth secret
   - `OPENAI_API_KEY` - OpenAI API key
   - `OAUTH_SECRET` - Session secret

## Discord Commands

- `/startmeeting` - Begin recording in current voice channel

## Testing

Tests are in `test/` directory using Jest. Run individual tests:

```bash
yarn test -- --testNamePattern="specific test name"
```

## Dependencies

**Core:** discord.js v14, OpenAI v5, Express v5, TypeScript v5
**Audio:** @discordjs/voice, ffmpeg-static, fluent-ffmpeg
**Cloud:** AWS SDK (DynamoDB), Terraform
**Auth:** Passport.js with Discord OAuth
