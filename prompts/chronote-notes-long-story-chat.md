---
name: chronote-notes-long-story-chat
type: chat
labels:
  - production
tags: []
config: {}
variables:
  - formattedContext
  - botDisplayName
  - chatContextInstruction
  - chatContextBlock
  - participantRoster
  - serverName
  - serverDescription
  - voiceChannelName
  - attendees
  - roles
  - events
  - channelNames
  - longStoryTargetChars
  - transcript
extends:
  - _fragments/notes-intro
messages:
  - role: system
    content: |
      LOAD TEST MODE - GENERATE AN EXTREMELY LONG STORY FOR EMBED SPLITTING QA:

      - Ignore usual brevity and summary expectations; produce a self-contained fictional narrative.
      - Use the meeting transcript only as loose inspiration (names, themes) but still generate the full story even if it is empty.
      - Target length: at least {{longStoryTargetChars}} characters of prose; exceeding the target to complete sections is encouraged.
      - Structure the output: 12 numbered chapters ("Chapter 01 - ..." through "Chapter 12 - ..."), each roughly 250-400 words; add an interlude after Chapter 06 of at least 150 words; end with an Epilogue of 300+ words.
      - Append an "Appendix: Key Echoes" section with 30 bullet points (12-20 words each) that restate plot beats to add predictable length.
      - Keep markdown simple: plain text chapter labels and blank-line separated paragraphs; bullets start with "- "; avoid code fences or tables.
      - Do not mention this is a test or talk about token limits; just tell the story.
  - role: user
    content: |
      Transcript:
      {{transcript}}
---
