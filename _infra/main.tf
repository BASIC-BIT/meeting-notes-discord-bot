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
  backend "s3" {
    region = "us-east-1"
    bucket         = "meeting-notes-terraform-state-bucket"
    key            = "meeting-notes-terraform/state"
    dynamodb_table = "meeting-notes-terraform-state-locks"
    encrypt = true
  }
}


variable GITHUB_TOKEN {
  sensitive = true
}
variable AWS_TOKEN_KEY {
  sensitive = true
}
variable DISCORD_CLIENT_ID {
  sensitive = true
}
variable DISCORD_BOT_TOKEN {
  sensitive = true
}
variable OPENAI_API_KEY {
  sensitive = true
}
variable OPENAI_ORGANIZATION_ID {
  sensitive = true
}
variable OPENAI_PROJECT_ID {
  sensitive = true
}


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

resource "aws_vpc" "app_vpc" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "app-vpc"
  }
}

resource "aws_subnet" "app_public_subnet_1" {
  vpc_id                  = aws_vpc.app_vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "us-east-1a"

  tags = {
    Name = "app-public-subnet-1"
  }
}

resource "aws_subnet" "app_public_subnet_2" {
  vpc_id                  = aws_vpc.app_vpc.id
  cidr_block              = "10.0.2.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "us-east-1b"

  tags = {
    Name = "app-public-subnet-2"
  }
}

resource "aws_internet_gateway" "app_internet_gateway" {
  vpc_id = aws_vpc.app_vpc.id

  tags = {
    Name = "app-internet-gateway"
  }
}

resource "aws_route_table" "app_route_table" {
  vpc_id = aws_vpc.app_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app_internet_gateway.id
  }

  tags = {
    Name = "app-route-table"
  }
}

resource "aws_route_table_association" "public_subnet_1_assoc" {
  subnet_id      = aws_subnet.app_public_subnet_1.id
  route_table_id = aws_route_table.app_route_table.id
}

resource "aws_route_table_association" "public_subnet_2_assoc" {
  subnet_id      = aws_subnet.app_public_subnet_2.id
  route_table_id = aws_route_table.app_route_table.id
}

resource "aws_security_group" "ecs_service_sg" {
  vpc_id = aws_vpc.app_vpc.id

  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ecs-service-sg"
  }
}

resource "aws_cloudwatch_log_group" "app_log_group" {
  name              = "/ecs/meeting-notes-bot"
  retention_in_days = 7

  tags = {
    Name = "app-log-group"
  }
}

resource "aws_ecs_cluster" "main" {
  name = "meeting-notes-bot-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

# Define an IAM role for ECS task execution
resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecs_task_execution_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Effect = "Allow",
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Attach the required policy to the execution role
resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Update the ECS task definition to include the execution role ARN
resource "aws_ecs_task_definition" "app_task" {
  family                   = "meeting-notes-bot-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = "meeting-notes-bot"
      image     = aws_ecr_repository.app_ecr_repo.repository_url
      cpu       = 1024
      memory    = 2048
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app_log_group.name
          "awslogs-region"        = "us-east-1"
          "awslogs-stream-prefix" = "ecs"
        }
      }
      environment = [
        {
          name  = "DISCORD_CLIENT_ID"
          value = var.DISCORD_CLIENT_ID
        },
        {
          name  = "DISCORD_BOT_TOKEN"
          value = var.DISCORD_BOT_TOKEN
        },
        {
          name  = "OPENAI_API_KEY"
          value = var.OPENAI_API_KEY
        },
        {
          name = "OPENAI_ORGANIZATION_ID"
          value = var.OPENAI_ORGANIZATION_ID
        },
        {
          name = "OPENAI_PROJECT_ID"
          value = var.OPENAI_PROJECT_ID
        }
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3001/health || exit 1"]
        interval    = 30      # seconds
        timeout     = 5       # seconds
        retries     = 3
        startPeriod = 60      # seconds, grace period before health checks start
      }
    }
  ])
}

resource "aws_ecs_service" "app_service" {
  name            = "meeting-notes-bot-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app_task.arn
  lifecycle {
    ignore_changes = [
      task_definition
    ]
  }

  enable_execute_command = true

  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_controller {
    type = "ECS"
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent = 200

  network_configuration {
    subnets         = [aws_subnet.app_public_subnet_1.id, aws_subnet.app_public_subnet_2.id]
    security_groups = [aws_security_group.ecs_service_sg.id]
    assign_public_ip = true
  }
}

resource "aws_dynamodb_table" "subscription_table" {
  name           = "SubscriptionTable"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "UserID"

  attribute {
    name = "UserID"
    type = "S"
  }

  tags = {
    Name = "SubscriptionTable"
  }
}

resource "aws_dynamodb_table" "payment_transaction_table" {
  name           = "PaymentTransactionTable"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "TransactionID"

  attribute {
    name = "TransactionID"
    type = "S"
  }

  tags = {
    Name = "PaymentTransactionTable"
  }
}

resource "aws_dynamodb_table" "access_logs_table" {
  name           = "AccessLogsTable"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "AccessLogID"

  attribute {
    name = "AccessLogID"
    type = "S"
  }

  tags = {
    Name = "AccessLogsTable"
  }
}

resource "aws_dynamodb_table" "recording_transcript_table" {
  name           = "RecordingTranscriptTable"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "MeetingID"

  attribute {
    name = "MeetingID"
    type = "S"
  }

  tags = {
    Name = "RecordingTranscriptTable"
  }
}

# Output the VPC ID
output "vpc_id" {
  value = aws_vpc.app_vpc.id
}

# Output the Subnet IDs
output "public_subnet_ids" {
  value = [aws_subnet.app_public_subnet_1.id, aws_subnet.app_public_subnet_2.id]
}

# Output the Security Group ID
output "ecs_service_sg_id" {
  value = aws_security_group.ecs_service_sg.id
}
