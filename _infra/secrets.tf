locals {
  secrets_prefix = local.name_prefix
  secrets_tags = {
    Project     = "${var.project_name}-discord-bot"
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret" "discord_bot_token" {
  name        = "${local.secrets_prefix}/discord-bot-token"
  description = "Discord bot token"
  tags        = local.secrets_tags
}

resource "aws_secretsmanager_secret" "discord_client_secret" {
  name        = "${local.secrets_prefix}/discord-client-secret"
  description = "Discord OAuth client secret"
  tags        = local.secrets_tags
}

resource "aws_secretsmanager_secret" "oauth_secret" {
  name        = "${local.secrets_prefix}/oauth-secret"
  description = "Session/OAuth secret"
  tags        = local.secrets_tags
}

resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = "${local.secrets_prefix}/openai-api-key"
  description = "OpenAI API key"
  tags        = local.secrets_tags
}

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name        = "${local.secrets_prefix}/stripe-secret-key"
  description = "Stripe secret API key"
  tags        = local.secrets_tags
}

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name        = "${local.secrets_prefix}/stripe-webhook-secret"
  description = "Stripe webhook signing secret"
  tags        = local.secrets_tags
}

data "aws_iam_policy_document" "ecs_secrets_policy" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.discord_bot_token.arn,
      aws_secretsmanager_secret.discord_client_secret.arn,
      aws_secretsmanager_secret.oauth_secret.arn,
      aws_secretsmanager_secret.openai_api_key.arn,
      aws_secretsmanager_secret.stripe_secret_key.arn,
      aws_secretsmanager_secret.stripe_webhook_secret.arn,
    ]
  }
}

resource "aws_iam_policy" "ecs_task_secrets_policy" {
  name   = "${local.name_prefix}-ecs-task-secrets"
  policy = data.aws_iam_policy_document.ecs_secrets_policy.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_exec_secrets_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.ecs_task_secrets_policy.arn
}

output "secrets_manager_arns" {
  description = "Secrets Manager ARNs for application secrets"
  value = {
    discord_bot_token      = aws_secretsmanager_secret.discord_bot_token.arn
    discord_client_secret  = aws_secretsmanager_secret.discord_client_secret.arn
    oauth_secret           = aws_secretsmanager_secret.oauth_secret.arn
    openai_api_key         = aws_secretsmanager_secret.openai_api_key.arn
    stripe_secret_key      = aws_secretsmanager_secret.stripe_secret_key.arn
    stripe_webhook_secret  = aws_secretsmanager_secret.stripe_webhook_secret.arn
  }
}
