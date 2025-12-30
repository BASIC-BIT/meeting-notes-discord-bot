# Transcription eval runner

This CLI runs repeated transcription passes against a local audio clip and summarizes variance.

## Local file runs

yarn eval:transcription --file audio/sample.wav --runs 10 --language en --temperature 0

Optional flags:

- --prompt-file prompts/chronote-transcription-cleanup.md
- --glossary-file prompts/\_fragments/transcription-glossary.md
- --reference-file docs/evals/reference.txt
- --output docs/evals/run-2025-12-30.json

## Langfuse dataset runs

LANGFUSE_EVAL_DATASET=transcription-eval

yarn eval:transcription --dataset transcription-eval --runs 5

Dataset input example:
{
"file": "audio/clip.wav",
"language": "en",
"prompt": "...",
"promptFile": "prompts/chronote-transcription-cleanup.md",
"glossaryFile": "prompts/\_fragments/transcription-glossary.md",
"runs": 5,
"temperature": 0
}

Expected output example:
{
"transcript": "Reference transcript text"
}

Notes:

- Paths are resolved from the repo root.
- WER is computed with word level Levenshtein distance.
- With --drop-prompt-like, prompt leakage outputs are counted but replaced with empty strings.
