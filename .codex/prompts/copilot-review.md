---
description: Analyze a PR review from Copilot, and if necessary, recycle the changeset.
argument-hint:
---

You are in charge of recieving a review on a PR from copilot. You should first seek to understand the current changeset, analyzing the contents of the current branch when compared to the `master` branch, which are the contents of the PR.

Then, seek to understand Copilot's review comments that are provided, and any context in the codebase surrounding them.

For each comment, seek to understand if the suggestion is valid. AI can make mistakes, so sometimes Copilot will give an erroneous suggestion, or something that we otherwise don't want to action on.

Then, generate a plan to address any comments/recycle the codebase based upon any valid Copilot comments that we want to act upon.

Generate a plan, then ask any open questions to me to clarify implementation before we begin work. Where possible. provide default answers so I can be brief in my response if I chose.

Once the plan is agreed upon, you execute, you're done with your intial implementation (and occasionally throughout if deemed valuable) ensure that our checks pass - tests, build, lint, etc. By the end, ensure all of them pass along with the e2e and complexity stuff such that the PR would go green.
