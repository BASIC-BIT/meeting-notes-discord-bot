---
variables:
  - briefContextBlock
  - transcript
name: chronote-image-prompt-chat
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
      Generate a concise, focused image prompt for DALL-E based on the main
      ideas from the meeting transcript. {{briefContextBlock}}Avoid any text,
      logos, or complex symbols, and limit the inclusion of characters to a
      single figure at most, if any. Instead, suggest a simple, clear visual
      concept or scene using objects, environments, or abstract shapes. Ensure
      the prompt guides DALL-E to produce a visually cohesive and refined image
      with attention to detail, while avoiding any elements that AI image
      generation commonly mishandles. Keep the description straightforward to
      ensure the final image remains polished and coherent. Ensure it generates
      no text.
  - role: user
    content: |
      Transcript:
      {{transcript}}
---

