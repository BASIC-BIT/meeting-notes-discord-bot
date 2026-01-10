# Langfuse LLM connection sync

This repo keeps Langfuse LLM connections in YAML so they can be reviewed and synced in CI.

## Location

- Connection files live in `langfuse/llm-connections/*.yml`.
- File name does not matter, `provider` is the primary key.

## YAML schema

```yaml
provider: openai
adapter: openai
secretKeyEnv: OPENAI_API_KEY
baseUrl: https://api.openai.com/v1
withDefaultModels: true
customModels:
  - gpt-5.2
  - gpt-5.1
  - gpt-5-mini
extraHeadersEnv:
  OpenAI-Project: OPENAI_PROJECT_ID
environments:
  - prod
  - staging
```

Notes:

- `provider` must be unique per Langfuse project.
- `adapter` must be one of: `openai`, `azure`, `anthropic`, `bedrock`, `google-vertex-ai`, `google-ai-studio`.
- `secretKeyEnv` is recommended for secrets; `secretKey` is supported for local-only use.
- `extraHeadersEnv` maps header keys to env var names.
- `baseUrl` is optional, use it for OpenAI compatible proxies.
- `config` is required for Bedrock (`{ "region": "us-east-1" }`).
- `environments` is optional. If set, use `--env` or `LLM_CONNECTIONS_ENV` to filter.

## Bedrock example

```yaml
provider: bedrock
adapter: bedrock
secretKeyEnv: LANGFUSE_LLM_SECRET_BEDROCK
withDefaultModels: true
customModels:
  - anthropic.claude-3-5-sonnet-20240620-v1:0
config:
  region: us-east-1
```

Notes:

- Use model IDs that are supported in the configured region.

## Commands

```bash
yarn llm-connections:push
yarn llm-connections:pull
yarn llm-connections:check
```

Flags:

- `--dir <path>` to override the default directory.
- `--env <name>` to filter by `environments`.
- `--dry-run` for push and pull.
- `--limit <n>` for pull paging (clamped to 100).

## CI behavior

`yarn llm-connections:check` runs in CI using `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_BASE_URL`. It compares local YAML with Langfuse without reading secrets.
