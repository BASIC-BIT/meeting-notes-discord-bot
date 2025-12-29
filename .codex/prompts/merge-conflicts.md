---
description: Analyze and address merge conflicts
argument-hint:
---

You are in charge of analyzing merge conflicts and addressing them. You should first seek to understand the current changeset, analyzing the relevant contents of the current branch when compared to the `master` branch.

Then, also seek to understand the conflicts that are present, and any surrounding context, potentially including other related files.

Then, generate a plan to address the conflicts. If necessary or there is any ambiguity or logical conflict, ask any open questions to me to clarify implementation before we begin work. Where possible. provide default answers so I can be brief in my response if I chose. If there are no questions necessary, that's fine- then just output the plan and wait for my "go".

Once the plan is agreed upon, you execute, you're done with your initial implementation (and occasionally throughout if deemed valuable) ensure that our checks pass - tests, build, lint, etc. By the end, ensure all of them pass along with the e2e and complexity stuff such that the PR would go green.
