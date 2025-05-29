# Progress: Meeting Notes Discord Bot - Initial State

## 1. What Works (Based on Code Analysis)

*   **Core Bot Functionality:**
    *   Bot login and readiness (`src/bot.ts`).
    *   Slash command registration (`/startmeeting`).
    *   Handling of button interactions for starting and ending meetings, and for selecting transcription/notes options.
    *   Joining user's voice channel (`src/commands/startMeeting.ts`, `@discordjs/voice`).
    *   Leaving voice channel upon meeting end or if all users leave.
*   **Meeting Lifecycle Management:**
    *   Tracking active meetings in memory (`src/meetings.ts`).
    *   Recording start time, attendance, chat logs.
    *   Automatic meeting termination after a maximum duration (`MAXIMUM_MEETING_DURATION`).
    *   Graceful shutdown procedure to complete ongoing meetings (`src/bot.ts`).
*   **Audio Recording & Processing:**
    *   Receiving and decoding Opus audio streams from multiple users (`src/audio.ts`, `@discordjs/voice`, `prism-media`).
    *   Buffering audio into snippets per user, with silence detection and max length handling.
    *   Converting raw PCM audio to a single MP3 file per meeting using `fluent-ffmpeg`.
    *   Splitting large MP3 files into chunks compliant with Discord's upload limit.
*   **Chat Logging:**
    *   Collecting messages from the text channel where the meeting was initiated.
*   **Output Generation:**
    *   Creating and sending a summary embed with meeting metadata (start/end time, duration, attendees) (`src/embed.ts`).
    *   Attaching chat log as a `.txt` file.
    *   Attaching audio recording(s) as `.mp3` file(s).
*   **Transcription (Optional):**
    *   Converting individual audio snippets (PCM) to WAV format.
    *   Sending WAV files to OpenAI GPT-4o-transcribe API for transcription (`src/transcription.ts`).
    *   Compiling individual snippet transcriptions into a single meeting transcript.
    *   Sending the full transcript as a `.txt` file.
    *   Implementing resilience patterns (retry, circuit breaker, rate limiting) for OpenAI API calls.
*   **AI-Generated Content (Optional, if transcription is enabled):**
    *   Generating meeting notes, summaries, to-do lists, and images using OpenAI GPT-4o and DALL-E 3 based on the full transcript.
    *   Sending these generated contents as embeds or messages.
*   **Deployment & Infrastructure:**
    *   Dockerfile for containerizing the application.
    *   Terraform scripts for provisioning AWS infrastructure (ECR, ECS, VPC, S3, DynamoDB for state locking).
    *   GitHub Actions workflow for CI/CD (build, push to ECR, deploy to ECS).
*   **Basic Web Server:**
    *   Express server with a `/health` endpoint.
    *   Discord OAuth setup using Passport.js (`src/webserver.ts`).
*   **Utility Functions:**
    *   File system helpers for checking existence, deleting files/directories (`src/util.ts`).

## 2. What's Left to Build (Potential/Inferred)

*   **Full Integration of `db.ts`:**
    *   The database interaction layer (`src/db.ts`) for `SubscriptionTable`, `PaymentTransactionTable`, `AccessLogsTable`, `RecordingTranscriptTable` is defined but not actively used in the core meeting flow. Integrating this would enable:
        *   Persistent storage of meeting records and transcripts.
        *   User subscription/tier management (premium features).
        *   Payment processing tracking.
        *   Detailed access logging.
*   **Frontend Application (`src/frontend/`):**
    *   The Create React App frontend is present but its integration and purpose are unclear beyond potential OAuth handling. Development of a user-facing dashboard or settings interface could be a future step.
*   **Advanced Meeting Management Features:**
    *   Editing meeting details post-completion.
    *   Searching past meetings/transcripts (would require database integration).
    *   More granular permissions for accessing recordings/transcripts.
*   **Enhanced Error Reporting/Monitoring:** While basic error handling exists, more comprehensive logging and monitoring (e.g., integrating with a service like Sentry or AWS CloudWatch Logs beyond basic ECS logs) could be beneficial.
*   **Scalability Improvements:**
    *   Moving from in-memory meeting state to a distributed cache or database for multi-instance deployments.
    *   Optimizing FFmpeg processing if it becomes a bottleneck.
*   **More Sophisticated AI Features:**
    *   Speaker diarization (identifying who said what more accurately than just per-snippet attribution).
    *   More interactive AI features or custom prompt engineering.
*   **Testing Coverage:** `test/transcribe.test.ts` contains a very basic test. `src/frontend/App.test.tsx` is a default CRA test. More comprehensive unit and integration tests for the backend logic would improve robustness.

## 3. Current Status

*   The bot appears to be functional with its core feature set: recording, basic processing, optional transcription, and AI-generated content.
*   Deployment infrastructure and CI/CD pipeline are in place.
*   The Memory Bank is currently being initialized to document this existing state.

## 4. Known Issues (Inferred or Potential)

*   **Data Loss on Restart:** Due to in-memory storage of active meeting data, any bot crash or restart will lose data for ongoing meetings that haven't completed processing.
*   **FFmpeg Resource Usage:** FFmpeg can be resource-intensive; performance under high load (many concurrent meetings) is unknown.
*   **OpenAI API Costs:** Reliance on OpenAI APIs means operational costs will scale with usage. This is acknowledged in the user flow.
*   **Transcription Accuracy:** Whisper is generally good, but accuracy can vary. The "keywords" prompt enhancement helps, but complex audio or niche topics might still have errors. The current transcription cleanup prompt is a good step but might need refinement.
*   **OAuth Flow Purpose:** The exact use case and completion status of the Discord OAuth flow via the webserver are not fully clear from the backend code alone.

## 5. Evolution of Project Decisions (Initial Understanding)

*   **Initial Concept:** A tool to record Discord voice meetings and provide basic outputs (audio, chat log).
*   **AI Integration:** Expanded to include OpenAI Whisper for transcription, significantly increasing utility.
*   **GPT-4o Audio Migration (2025-05-29):** Upgraded from Whisper-1 to GPT-4o-transcribe for improved transcription accuracy and enhanced context understanding.
*   **Further AI Enhancements:** Leveraged the transcript to provide more value-added features like summaries, notes, and to-do lists using GPT models, and image generation with DALL-E.
*   **Operationalization:** Recognized the need for robust deployment, leading to Dockerization, Terraform for IaC on AWS, and a CI/CD pipeline.
*   **Resilience for External APIs:** Implemented patterns like retries and circuit breakers for OpenAI calls, indicating experience with external service dependencies.
*   **Modularity:** The codebase was structured into modules for better organization as features were added.
*   **Future-Proofing (Potential):** The inclusion of `db.ts` and a basic web server/frontend setup suggests planning for future expansion, possibly including user accounts, premium features, or a web interface.
