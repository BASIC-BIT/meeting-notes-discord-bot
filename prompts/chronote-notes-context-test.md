---
name: chronote-notes-context-test
type: text
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
extends:
  - _fragments/notes-intro
  - _fragments/notes-context-test
  - _fragments/notes-format-guidance
---
