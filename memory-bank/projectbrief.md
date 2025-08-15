# Project Brief: Meeting Notes Discord Bot

## 1. Project Purpose

The Meeting Notes Discord Bot is a tool designed to record and transcribe audio from Discord voice channels. It compiles the recorded data, along with chat logs and attendance, into a detailed meeting summary.

## 2. Core Requirements

- **Start Meeting:** Users must be able to initiate a meeting recording using a slash command (`/startmeeting`).
  - The bot should join the user's current voice channel.
  - The bot should begin capturing audio from all participants (excluding itself).
  - The bot should log chat messages from the associated text channel during the meeting.
- **End Meeting:** Users (with appropriate permissions) must be able to end an ongoing meeting.
  - The bot should stop recording audio and chat.
  - The bot should process the collected data.
- **Output Generation:**
  - Provide a meeting summary including attendance, start/end times, duration, and voice channel.
  - Provide the chat log as a text file.
  - Provide the recorded audio as one or more MP3 files.
  - Optionally, provide an AI-generated transcription of the audio.
  - Optionally, provide AI-generated meeting notes, summaries, to-do lists, or images based on the transcription.
- **User Interaction:**
  - Clear notifications for meeting start and end.
  - Buttons for initiating transcription/notes options and for ending the meeting.
- **Deployment & Hosting:** The bot should be deployable and hosted, with infrastructure managed by Terraform on AWS.
- **Permissions:** The bot should respect Discord permissions for joining channels and sending messages. Meeting termination should be restricted to the meeting creator or users with server moderation permissions.

## 3. Project Goals

- **Automate Note-Taking:** Reduce the manual effort required to document meetings held on Discord.
- **Improve Accessibility:** Provide transcripts and summaries for those who missed a meeting or need a quick review.
- **Enhance Collaboration:** Offer structured outputs like to-do lists to facilitate follow-up actions.
- **Reliability:** Ensure the bot reliably records and processes meeting data.
- **Ease of Use:** Provide a simple and intuitive command interface for users.
- **Extensibility:** Allow for future enhancements and new features related to meeting data processing.

## 4. Scope

**In Scope:**

- Recording audio from Discord voice channels.
- Logging chat messages from the text channel where the meeting was initiated.
- Tracking attendance of users in the voice channel.
- Generating a summary embed with meeting metadata.
- Providing audio recordings as downloadable files.
- Providing chat logs as downloadable files.
- Optional AI-powered transcription of audio.
- Optional AI-powered generation of notes, summaries, and to-do lists from transcriptions.
- Basic web server for health checks and potential OAuth integration.
- CI/CD pipeline for automated deployments.
- Infrastructure as Code (IaC) using Terraform for AWS resources.

**Out of Scope (for initial version, unless explicitly stated otherwise by current features):**

- Real-time transcription during the meeting.
- Advanced audio editing features.
- Complex user account management beyond Discord authentication.
- Direct monetization features (though donation links are present).
- A fully-featured frontend application beyond what's needed for OAuth or basic info (current frontend in `src/frontend` seems to be a standard CRA template).
