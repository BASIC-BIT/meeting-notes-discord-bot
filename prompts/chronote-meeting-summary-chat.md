---
variables:
  - todayLabel
  - serverName
  - channelName
  - tagLine
  - recentMeetingNames
  - previousSummaryBlock
  - notes
name: chronote-meeting-summary-chat
type: chat
version: 1
labels:
  - production
tags: []
config: {}
commitMessage: Sync prompts from repo
messages:
  - role: system
    content: >
      You generate a short meeting name and a one sentence summary for a
      meeting. Return EXACTLY one JSON object with keys "summarySentence" and
      "summaryLabel". The summarySentence must be one sentence. The
      summaryLabel must be 5 words or fewer and use only letters, numbers, and
      spaces. If a value would be empty or unclear, omit that key. Do not       
      include any other keys or prose. Prefer a meeting name that is distinct   
      from the recent meeting names when possible. If you feel you need two
      sentences, merge them into one with commas or semicolons. Avoid
      abbreviations that end with periods; spell out titles when possible.
  - role: user
    content: |
      Today is {{todayLabel}}.
      Server: {{serverName}}
      Channel: {{channelName}}
      Tags: {{tagLine}}
      Recent meeting names:
      {{recentMeetingNames}}
      {{previousSummaryBlock}}
      Notes:
      {{notes}}
---

