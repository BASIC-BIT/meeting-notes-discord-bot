terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
}


variable GITHUB_TOKEN {}

variable AWS_TOKEN_KEY {}

provider "aws" {
  region = "us-east-1"
}

provider "github" {
  owner = "BASIC-BIT"
  token = var.GITHUB_TOKEN
}

resource "aws_ecr_repository" "app_ecr_repo" {
  name = "meeting-notes-bot-repo"
  image_tag_mutability = "MUTABLE"
}

resource "aws_ecr_lifecycle_policy" "app_ecr_repo_lifecycle_policy" {
  repository = aws_ecr_repository.app_ecr_repo.name

  policy = <<EOF
{
    "rules": [
        {
            "rulePriority": 1,
            "description": "Keep last two images",
            "selection": {
                "tagStatus": "any",
                "countType": "imageCountMoreThan",
                "countNumber": 2
            },
            "action": {
                "type": "expire"
            }
        }
    ]
}
EOF
}

data "github_repository" "repo" {
  full_name = "BASIC-BIT/meeting-notes-discord-bot"
}

resource "github_repository_environment" "repo_sandbox_env" {
  repository = data.github_repository.repo.name
  environment = "sandbox"
}

resource "github_actions_environment_variable" "envvar_aws_region" {
  repository = data.github_repository.repo.name
  environment = github_repository_environment.repo_sandbox_env.environment
  variable_name = "AWS_REGION"
  value = "us-east-1"
}

resource "github_actions_environment_variable" "envvar_ecr_repository" {
  repository = data.github_repository.repo.name
  environment = github_repository_environment.repo_sandbox_env.environment
  variable_name = "ECR_REPOSITORY"
  value = aws_ecr_repository.app_ecr_repo.name
}

resource "github_actions_environment_variable" "envvar_aws_access_key_id" {
  repository = data.github_repository.repo.name
  environment = github_repository_environment.repo_sandbox_env.environment
  variable_name = "AWS_ACCESS_KEY_ID"
  value = var.AWS_TOKEN_KEY
}

### AppRunner backend

resource "aws_iam_role" "ecrAccessorRole" {
  name               = "MeetingNotesDiscordBotEcrAccessorRole"
  assume_role_policy = data.aws_iam_policy_document.apprunner_assume_role_policy.json
}

resource "aws_iam_role_policy_attachment" "ecrAccessorRole_policy" {
  role       = aws_iam_role.ecrAccessorRole.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

data "aws_iam_policy_document" "apprunner_assume_role_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com", "build.apprunner.amazonaws.com", "apprunner.amazonaws.com"]
    }
  }
}

resource "aws_apprunner_service" "api" {
  service_name = "meeting-notes-bot-api"
  source_configuration {
    image_repository {
      image_configuration {
        port = "3001"
      }
      image_identifier      = "079358094174.dkr.ecr.us-east-1.amazonaws.com/meeting-notes-bot-repo:latest"
      image_repository_type = "ECR"
    }
    auto_deployments_enabled = true
    authentication_configuration {
      access_role_arn = aws_iam_role.ecrAccessorRole.arn
    }
  }
  instance_configuration {
    cpu = "256"
    memory = "512"
  }
  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.api_scaling.arn
}

resource "aws_apprunner_auto_scaling_configuration_version" "api_scaling" {
  auto_scaling_configuration_name = "meeting-notes-bot-api-scaling"

  max_concurrency = 1
  max_size        = 1
  min_size        = 1
}
