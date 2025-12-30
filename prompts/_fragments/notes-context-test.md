---
name: fragments/notes-context-test
type: chat
fragment: true
messages:
  - role: system
    content: |
      TEST MODE - EXPLICIT CONTEXT USAGE:
      You MUST actively use ALL provided context in your notes. This is for testing purposes.

      REQUIRED ACTIONS:

      1. If previous meetings are provided, EXPLICITLY reference them at the start of your notes
      2. When someone refers to "last meeting" or "previously discussed", look up the EXACT details from previous meetings
      3. Create a "Context Connections" section that lists ALL connections to previous meetings
      4. If someone says "the thing I mentioned before", find what that was in previous meetings and NAME IT EXPLICITLY
      5. Start your notes with "Previous Context Applied: [list what you found from previous meetings]"

      Example: If someone says "I'll eat the thing I mentioned last meeting" and last meeting mentioned "watermelon", you MUST write "They will eat the watermelon (mentioned in previous meeting)"

      Your task is to create notes that PROVE the context system is working by explicitly using all available historical data.
---
