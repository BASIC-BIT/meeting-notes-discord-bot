# Product Context: Meeting Notes Discord Bot

## 1. Why This Project Exists

In many online communities and teams using Discord, voice channel discussions are a primary mode of communication for meetings, planning sessions, or collaborative work. However, valuable information shared in these sessions can be easily lost or forgotten if not diligently documented. Manually taking notes during a live discussion can be distracting and inefficient. This project aims to solve this by providing an automated way to capture and summarize these interactions.

## 2. Problems It Solves

*   **Information Loss:** Prevents important decisions, action items, and discussion points from being lost after a voice meeting ends.
*   **Manual Note-Taking Burden:** Frees participants from the need to manually take comprehensive notes, allowing them to focus on the discussion.
*   **Accessibility & Catch-Up:** Makes meeting content accessible to those who couldn't attend or need a refresher on what was discussed.
*   **Inefficient Review:** Transcripts and summaries make it easier and faster to review meeting outcomes compared to re-listening to entire audio recordings.
*   **Lack of Accountability:** Generated to-do lists can help track action items and assign responsibility.

## 3. How It Should Work (User Experience)

*   **Initiation:** A user in a voice channel should be able to easily start a recording session with a simple slash command (`/startmeeting`). The bot should clearly indicate it has started recording.
*   **Options:** Before starting, the user should be presented with clear options regarding transcription and AI-generated notes, understanding the implications (e.g., cost of AI services).
*   **During Meeting:** The bot should be unobtrusive. It records audio and logs chat messages in the background. Attendance is tracked automatically.
*   **Ending Meeting:** The meeting creator or a user with appropriate server permissions should be able to end the meeting via a button. The bot should confirm the meeting has ended.
*   **Output Delivery:**
    *   A summary embed message should be posted in the text channel where the meeting was initiated. This embed should contain key metadata (start/end time, duration, attendees).
    *   Chat logs and audio files (split into manageable chunks if large) should be provided as downloadable attachments.
    *   If transcription was requested, the transcript should be provided as a text file.
    *   If AI-generated notes/summaries/todos were requested, these should be presented clearly, likely in an embed or as text.
*   **Clarity:** All bot messages and outputs should be clear, concise, and easy to understand.
*   **Permissions:** The bot should respect Discord's permission system. It shouldn't be able to join channels or send messages where it's not allowed.

## 4. User Experience Goals

*   **Simplicity:** The bot should be extremely easy to use, requiring minimal commands and configuration from the user.
*   **Reliability:** Users should trust that the bot will consistently and accurately record meetings and provide the requested outputs.
*   **Speed:** While AI processing takes time, the initial feedback (meeting started/ended, basic summary) should be prompt. Processing status for longer tasks like transcription should be communicated if possible.
*   **Usefulness:** The outputs (summaries, transcripts, notes) should be genuinely helpful and save users time.
*   **Transparency:** Users should be aware of what the bot is doing (e.g., "Processing transcription... please wait..."). If there are costs associated with features (like OpenAI API usage), this should be communicated (as it is in the start meeting flow).
