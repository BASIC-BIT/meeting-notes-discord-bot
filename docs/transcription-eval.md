# Transcription eval runner

This CLI runs repeated transcription passes against labeled audio and measures unwanted text, dropped speech, recognition errors, and request usage.

## Production pipeline corpus runs

Use `--manifest` to compare the raw provider with the same audio gate, conversion, transcript guards, and candidate selection used by the bot. No Langfuse dataset is required. Corpus tracing stays disabled and results stay in an ignored artifact directory.

```powershell
npm run eval:transcription:corpus -- --speech
npm run eval:transcription -- --manifest <printed-manifest-path> --mode preflight --runs 1
npm run eval:transcription -- --manifest <printed-manifest-path> --mode provider --runs 3 --max-requests 100
npm run eval:transcription -- --manifest <printed-manifest-path> --mode pipeline --pass-mode fast --runs 3 --max-requests 100
npm run eval:transcription -- --manifest <printed-manifest-path> --mode pipeline --pass-mode slow --runs 3 --max-requests 150
```

Corpus preparation generates eight nonspeech controls. `--speech` adds eight short TTS requests and produces normal, quiet, and Opus speech variants. Synthetic labels come from independent synthesis inputs; they are controls, not proof of real Discord quality.

Each manifest case requires an audio SHA-256, split, tags, and explicit speech/nonspeech/unreviewed label with provenance. Every repetition is scored. An empty expected transcript means nonspeech; an absent reference is unscored. Provider failures and exhausted budgets stay unscored, retain request accounting, and cause a nonzero exit code. SDK retries are disabled in corpus mode. Usage is retained for every successful response; dollar cost is unpriced.

`--policy` loads validated guard settings, `--prompt-file` changes the prompt, and `--split tune` limits development runs. Keep a fresh holdout separate from tuning. `--vad-report` applies experimental detector decisions bound to each clip's hash. The optional Silero Python script is an offline experiment and does not change the production bot.

Keep real recordings, references, and results in the private ops workspace. Use `--artifact-dir D:/bench/chronote-ops/.cache/transcription-eval`, with any explicit `--output` inside that directory. Production recording replay retains the private ops authorization requirement.

See [the October 13 findings and run instructions](analysis/2026-10-13-transcription-quality-evals.md) for the corpus format, optional speech detector, observed results, and release limits.

## Local file runs

```bash
yarn eval:transcription --file audio/sample.wav --runs 10 --language en --temperature 0
```

Optional flags:

- --prompt-file prompts/chronote-transcription-cleanup-chat.md
- --glossary-file docs/evals/transcription-glossary.txt
- --reference-file docs/evals/reference.txt
- --output .cache/transcription-eval/run.json

## Bedrock Data Automation runs

```bash
BEDROCK_DATA_AUTOMATION_PROFILE_ARN=arn:aws:bedrock:us-east-1:123456789012:data-automation-profile/abc
```

```bash
yarn eval:transcription --provider bedrock --file audio/sample.wav --runs 3
```

Required env vars for Bedrock evals:

- BEDROCK_DATA_AUTOMATION_PROFILE_ARN
- BEDROCK_DATA_AUTOMATION_INPUT_BUCKET (optional if TRANSCRIPTS_BUCKET is set)
- BEDROCK_DATA_AUTOMATION_OUTPUT_BUCKET (optional if TRANSCRIPTS_BUCKET is set)

## Langfuse dataset runs

**Needs seeding first, and seeding needs a labelled clip (verified 2026-07-30).**
No `transcription-eval` dataset exists. Unlike the notes and summary evals, this
one cannot be seeded from the sample file as it stands: `docs/evals/transcription-eval.dataset.json`
points at `audio/clip.wav`, which is not in the repo, and grading needs a
reference transcript that a human has checked. Transcribing a clip with the same
model to produce that reference would be circular and grade nothing.

So seeding this is a content task, not a code task: add a short audio file, write
its reference transcript by hand, point a case at both, then:

```bash
yarn evals:upload --dataset transcription-eval --file docs/evals/transcription-eval.dataset.json
```

The local `--file` runs above work today and need no dataset.

Do not point this at the project's existing `Transcription` dataset. That one was
created outside this repo, holds a single item with an empty `expectedOutput`, and
its input shape does not match `DatasetInputSchema`, so it cannot grade. The
kebab-case name is the convention here, matching `meeting-notes` and
`meeting-summary`.

```bash
LANGFUSE_EVAL_DATASET=transcription-eval
```

```bash
yarn eval:transcription --dataset transcription-eval --runs 5
```

Dataset input example:

```json
{
  "file": "audio/clip.wav",
  "language": "en",
  "prompt": "...",
  "promptFile": "prompts/chronote-transcription-cleanup-chat.md",
  "glossaryFile": "docs/evals/transcription-glossary.txt",
  "runs": 5,
  "temperature": 0
}
```

Expected output example:

```json
{
  "transcript": "Reference transcript text"
}
```

Notes:

- Paths are resolved from the repo root.
- WER uses Unicode word segmentation and Levenshtein distance across every repetition. Exact match, nonspeech unwanted-output rate, and speech-drop rate also cover every repetition. Empty references are scoreable.
- With --drop-prompt-like, prompt leakage outputs are counted but replaced with empty strings.
- Chat prompt files are reduced to their system messages before use.
- Bedrock evals require AWS S3 and ignore STORAGE_ENDPOINT overrides.
- Sample dataset payloads live in docs/evals/transcription-eval.dataset.json.
