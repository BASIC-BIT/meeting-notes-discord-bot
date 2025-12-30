---
name: chronote-notes-system-chat
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
  - _fragments/notes-context-standard
  - _fragments/notes-format-guidance
messages:
  - role: user
    content: |
      Transcript:
      {{transcript}}
---
