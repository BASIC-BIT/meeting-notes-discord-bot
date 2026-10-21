# Responses API and meeting model evaluation design

Date: 2026-10-21

## Goal

Compare current OpenAI text models and the Responses API on the same meeting
inputs. Prepare a reversible migration while preserving the stored recording
contract, notes formatting, mention validation, cancellation and tracing.

The approved direction includes measuring cost and time until usable notes,
then evaluating simpler transcription pipelines. This first changeset prepares
the transport and model comparisons. It does not change production routing,
subscription behavior, transcription quality settings or live prompts.

## Current source

- The shared chat service covers notes, cleanup, coalescing and final-pass
  reconciliation. Summary, Discord and web corrections, personal-upload notes
  and the notes evaluator also make direct Chat Completions requests.
- OpenAI SDK 7.32.0 and Langfuse 5.13.1 are already pinned.
- Saved recording v1 settings freeze model names, resolved parameters and prompt
  templates. Keep those fields compatible and translate parameters at the request
  boundary.
- The notes default remains GPT-5.2. Current model overrides require separate
  verification and are not inferred from repository defaults.

## Chosen design

Add one shared text-generation service. It accepts the existing plain text
message shape, model, frozen-style parameters, tracing context, output format,
request budget and abort signal. It returns text only after the operation has
completed successfully.

The transport is explicit and defaults to Chat Completions. An optional
OPENAI_TEXT_API setting selects chat_completions or responses. Evaluation runs
can also select a transport explicitly. Invalid configuration fails at the
configuration boundary.

Map reasoning_effort to reasoning.effort, verbosity to text.verbosity and token
budgets to max_output_tokens for Responses. Use input message items and
store:false. Keep plain Markdown output for notes. Support JSON object and
strict JSON schema formats for callers that need structured results.

Responses may contain reasoning before the assistant message. Use the SDK
output_text helper and inspect terminal status and refusal items. Do not treat
text deltas or partial text as a completed result.

Keep context local. Do not add Conversations, previous_response_id, background
jobs or hosted tools to this migration. Audio transcription remains on the
audio endpoint.

## Continuation and cancellation

Single-call summaries and corrections remain single-call operations. The shared
long-text path has a named, finite request budget. A Responses continuation is
permitted only for text output stopped by max_output_tokens when usable text was
produced. Replay complete typed output items with the pinned SDK helper so
encrypted reasoning and assistant metadata survive.

Responses rejects declared JSON truncation, refusals, filtered results, empty
output, failed states, identical consecutive continuation chunks and exhausted
request budgets. This repetition check does not remove overlaps or establish
semantic progress. Never publish the accumulated prefix after failure. Pass the
existing abort signal to every SDK request and recheck it after settlement.

Production notes and the notes evaluator share a three-call SDK request budget.
Provider retries may add HTTP attempts, cost and latency within each SDK call.
Callers requesting JSON only in their prompt still use the text format; explicit
structured formats are required for the JSON truncation guard.

Existing Chat completion behavior remains the compatibility control. Do not
silently replace recovered model settings with current live configuration.

## Model support

Add selectable GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna and GPT-6 Astra profiles without
changing any default model.

GPT-6.1 Sol and Astra require reasoning and cannot receive temperature sampling
parameters. GPT-6 Sol and Luna support explicit none reasoning. Resolve unsupported
minimal reasoning to low for the new models. Preserve existing GPT-5 behavior.

## Evaluation sequence

1. Current model on Chat Completions.
2. The same model, prompt and effective parameters on Responses.
3. GPT-6.1 Sol with low reasoning on Responses.
4. GPT-6 Luna with the appropriate none or low reasoning profile.
5. Astra on a separately reported difficult-meeting set.

Evaluate strict output schemas and combined notes/title/summary generation as
separate changes after transport parity. Keep those effects distinguishable from
model selection and transcription-pass removal.

The representative corpus must preserve audio, chat, context, roster, prompts
and configuration. Add human audio-grounded checks for material facts, decisions,
actions, owners and deadlines. Existing mention and word-error checks remain
useful but do not establish factual quality.

Record total cost including retries and fallback requests, usage coverage,
reasoning and cached-token details, failures and recording-stop-to-delivered
usable notes. Do not substitute provider generation duration for user wait.

## Validation and rollout

Tests cover request conversion, terminal states, continuation, cancellation,
frozen parameter preservation, mention behavior and direct-call integration.
Run the existing CI gates and an independent source review before merge.

No real meeting replay, paid quality experiment, prompt promotion, production
deployment or model override is part of this source changeset. Promote routing
only after representative quality and cost measurements. Keep Chat Completions
and the previous model choices available for rollback.

## Alternatives

A model-ID-only change is insufficient because new reasoning models reject
some existing sampling parameters. A wholesale agent or Conversations rewrite
adds state ownership and recovery changes that the meeting-note task does not
need. Keeping all direct callers separate would make the evaluator and production
paths diverge.

## References

- [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Current model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [Langfuse OpenAI integration](https://langfuse.com/integrations/model-providers/openai-js)
