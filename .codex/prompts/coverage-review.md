---
description: Review code coverage and propose high impact tests.
argument-hint:
---

Analyze the current coverage report and identify the top coverage gaps that map to real capabilities. Prioritize a short list of low complexity tests that would exercise those gaps. Aim for breadth over exhaustive edge cases.

List any files that are excluded from coverage, and explain whether each exclusion is justified. If a coverage ignore comment is needed, prefer c8 ignore directives and require a brief justification.

Propose a changeset for tests and any coverage config updates. Ask clarifying questions before writing tests, and provide default answers where possible.
