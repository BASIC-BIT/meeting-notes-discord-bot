# Responses API and meeting model evaluation plan

Date: 2026-10-21

## Goal and design

Implement the approved transport and current-model evaluation foundation from
the [design](../specs/2026-10-21-responses-meeting-evaluation-design.md).

Keep existing models and Chat Completions as defaults. Do not change production
routing, saved recording schema, quality settings, billing, live prompts or
provider credentials.

## Task 1: prove the missing behavior

- Add Responses completion, refusal, filtered-output and empty-output assertions.
- Add GPT-6 reasoning and temperature compatibility assertions.
- Run the complete unit suite against the original implementation.

Observed RED on commit 224c3711b68fdfc04f820c4a57f6e26dbef32981:
all 12 new assertions failed, while 3,646 existing tests passed. All other CI jobs
completed successfully or were intentionally skipped. Source and tests are on
the isolated feature/responses-meeting-evaluation branch.

## Task 2: add the shared text request boundary

Create src/config/openaiText.ts and src/services/openaiTextService.ts. Validate
OPENAI_TEXT_API, preserving chat_completions as the default and accepting
responses explicitly.

The service owns SDK client creation and sanitized API/format/parameter tracing
metadata. Map frozen-style settings to the selected request format. Keep
Responses stateless with store:false. Support text, JSON object and strict JSON
schema output formats.

Retain single-request behavior for summary and correction callers. Production
notes and the notes evaluator share a named budget of three SDK calls; provider
retries may add HTTP attempts. Continue Responses only on text max_output_tokens
truncation with usable output, replaying the SDK output items. Responses rejects
refusals, declared incomplete JSON, filtered or empty results, identical
consecutive chunks and request-budget exhaustion. Propagate cancellation through
every dispatch and settlement.

## Task 3: migrate the meeting text callers

Route the existing shared chat service through the new boundary. Migrate direct
summary, Discord correction, web correction, personal-upload notes and notes-eval
requests through the same service.

Preserve prompt construction, frozen settings, mention allowlists, output
rendering, cancellation and each caller's fallback. Audio transcription stays
on its existing endpoint. Other direct text features are outside this first
migration wave.

## Task 4: support current models

Extend src/config/modelChoices.ts and src/services/openaiModelParams.ts with
GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna and GPT-6 Astra.

Require supported reasoning for Sol 6.1 and Astra. Allow temperature only with
none reasoning on Sol 6 and Luna. Map unsupported minimal reasoning to low for
these new models while preserving legacy GPT-5 fallback behavior. Do not alter
model defaults.

## Task 5: validate and review

Cover continuation item preservation, budget exhaustion, frozen parameters,
incomplete JSON and configuration validation. Run unit, build, lint, format,
Markdown, documentation, quality-ratchet and existing integration checks.
Request an independent code review, then fix material findings and re-run the
affected gates. Keep the PR in draft until validation is complete.

The local execution environment failed to start. Existing GitHub CI provides
the executable validation; no quality exception or production workflow is added.

## Evaluation after source validation

Run the existing notes dataset through the shared transport with fixed prompt
versions and identical rendered inputs. Example process configurations:

- OPENAI_TEXT_API=chat_completions and NOTES_MODEL=gpt-5.2.
- OPENAI_TEXT_API=responses and NOTES_MODEL=gpt-5.2.
- OPENAI_TEXT_API=responses and NOTES_MODEL=gpt-6.1-sol.
- OPENAI_TEXT_API=responses and NOTES_MODEL=gpt-6-luna.

Use separate experiment names. Check the traced effective model, reasoning and
API for every run. Existing mention graders establish formatting and mention
contracts, not factual meeting-note quality.

The summary's current 160-token cap includes reasoning. Keep that cap for
same-model transport parity; choose and record a suitable separate total-output
budget before comparing models that require reasoning.

Curate representative permitted recordings and a separate challenge set before
paid full-pipeline replays. Measure audio-grounded decisions, actions, owners,
deadlines, unsupported claims, complete cost and actual delivered-notes latency.
Do not claim savings or quality parity from source tests.

Strict output schema adoption, combined notes/title/summary generation,
duplicate cleanup removal and selective final verification remain separate
experiments after this foundation. They must not be conflated with API or model
effects.

## Rollback

Restore OPENAI_TEXT_API=chat_completions and the prior role model choices.
Existing recording v1 settings and prompts remain readable without migration.
