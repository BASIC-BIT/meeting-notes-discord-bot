---
description: Investigate and plan a changeset
argument-hint:
---

Investigate this error or idea thoroughly with both internet research and codebase research (including any/all relevant parts of the codebase including infra, frontend, backend, discord bot, package.json, documentation, etc.) and propose a changeset for review. Ask me open questions you have to clarify implementation before writing any code. Provide defaults for each of your questions if possible.

If the issue mentions a PR or Issue, use the github cli to get any information necessary.

Once the plan is agreed upon, you execute; when you're done with your initial implementation (and occasionally throughout if deemed valuable) ensure that our checks pass - tests, build, lint, etc. By the end, ensure all of them pass along with the e2e and complexity stuff such that the PR would go green.

Additionally, evaluate if any updates to documentation, copy, translations, repo rules, or any higher level structural changes should be made that seems to "fall out" naturally from this changeset and any review comments and your findings along the way. For anything "functional" (non-documentation), these should default to no action. For documentation, feel free to decide your default freely.
