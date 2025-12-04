terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
  }
  backend "s3" {
    region         = "us-east-1"
    bucket         = "meeting-notes-terraform-state-bucket"
    key            = "meeting-notes-terraform/state"
    dynamodb_table = "meeting-notes-terraform-state-locks"
    encrypt        = true
  }
}


variable "GITHUB_TOKEN" {
  sensitive = true
}
variable "AWS_TOKEN_KEY" {
  sensitive = true
}
variable "DISCORD_CLIENT_ID" {
  sensitive = true
}
variable "DISCORD_BOT_TOKEN" {
  sensitive = true
}
variable "OPENAI_API_KEY" {
  sensitive = true
}
variable "OPENAI_ORGANIZATION_ID" {
  sensitive = true
  default   = ""
}
variable "OPENAI_PROJECT_ID" {
  sensitive = true
  default   = ""
}

variable "TRANSCRIPTS_BUCKET" {
  description = "S3 bucket name for storing full meeting transcripts (leave blank to auto-generate)"
  type        = string
  default     = ""
}

variable "TRANSCRIPTS_PREFIX" {
  description = "Optional prefix inside the transcripts bucket"
  type        = string
  default     = ""
}

variable "ENABLE_OAUTH" {
  sensitive = false
  default   = "false"
}

variable "DISCORD_CLIENT_SECRET" {
  sensitive = true
  default   = ""
}

variable "DISCORD_CALLBACK_URL" {
  sensitive = true
  default   = ""
}

variable "OAUTH_SECRET" {
  sensitive = true
  default   = ""
}


provider "aws" {
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}

provider "github" {
  owner = "BASIC-BIT"
  token = var.GITHUB_TOKEN
}

locals {
  transcripts_bucket_name = var.TRANSCRIPTS_BUCKET != "" ? var.TRANSCRIPTS_BUCKET : "meeting-notes-transcripts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_ecr_repository" "app_ecr_repo" {
  name                 = "meeting-notes-bot-repo"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.app_general.arn
  }
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
  repository  = data.github_repository.repo.name
  environment = "sandbox"
}

resource "github_actions_environment_variable" "envvar_aws_region" {
  repository    = data.github_repository.repo.name
  environment   = github_repository_environment.repo_sandbox_env.environment
  variable_name = "AWS_REGION"
  value         = "us-east-1"
}

resource "github_actions_environment_variable" "envvar_ecr_repository" {
  repository    = data.github_repository.repo.name
  environment   = github_repository_environment.repo_sandbox_env.environment
  variable_name = "ECR_REPOSITORY"
  value         = aws_ecr_repository.app_ecr_repo.name
}

resource "github_actions_environment_variable" "envvar_aws_access_key_id" {
  repository    = data.github_repository.repo.name
  environment   = github_repository_environment.repo_sandbox_env.environment
  variable_name = "AWS_ACCESS_KEY_ID"
  value         = var.AWS_TOKEN_KEY
}

resource "aws_vpc" "app_vpc" {
  cidr_block = "10.0.0.0/16"

  tags = {
    Name = "app-vpc"
  }
}

#checkov:skip=CKV_AWS_130 reason: Public subnet kept (map_public_ip_on_launch=true) to avoid NAT cost; will move to private/NAT when budget allows.
resource "aws_subnet" "app_public_subnet_1" {
  #checkov:skip=CKV_AWS_130 reason: Public subnet kept (map_public_ip_on_launch=true) to avoid NAT cost; will move to private/NAT when budget allows.
  vpc_id                  = aws_vpc.app_vpc.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
  availability_zone       = "us-east-1a"

  tags = {
    Name = "app-public-subnet-1"
  }
}

#checkov:skip=CKV_AWS_130 reason: Public subnet kept (map_public_ip_on_launch=true) to avoid NAT cost; will move to private/NAT when budget allows.
resource "aws_subnet" "app_public_subnet_2" {
  #checkov:skip=CKV_AWS_130 reason: Public subnet kept (map_public_ip_on_launch=true) to avoid NAT cost; will move to private/NAT when budget allows.
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
  revoke_rules_on_delete = true

  lifecycle {
    create_before_destroy = true
  }
  description = "ECS service SG for meeting-notes-bot"
  vpc_id      = aws_vpc.app_vpc.id

  ingress {
    description = "Allow app traffic from the internet to port 3001"
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound HTTPS for Discord/OpenAI/AWS APIs
  egress {
    description = "Allow outbound HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # DNS to VPC resolver (10.0.0.2 for this VPC)
  egress {
    description = "Allow DNS (UDP) to VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["10.0.0.2/32"]
  }

  egress {
    description = "Allow DNS (TCP) to VPC resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.2/32"]
  }

  tags = {
    Name = "ecs-service-sg"
  }
}

resource "aws_cloudwatch_log_group" "app_log_group" {
  name              = "/ecs/meeting-notes-bot"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.app_general.arn

  tags = {
    Name = "app-log-group"
  }
}

resource "aws_kms_key" "app_general" {
  description             = "KMS key for ECR, CloudWatch logs, and other app resources"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid       = "AllowRootAccount",
        Effect    = "Allow",
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root" },
        Action    = "kms:*",
        Resource  = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs",
        Effect = "Allow",
        Principal = {
          Service = "logs.us-east-1.amazonaws.com"
        },
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ],
        Resource = "*"
      },
      {
        Sid    = "AllowDynamoDB",
        Effect = "Allow",
        Principal = {
          Service = "dynamodb.amazonaws.com"
        },
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey"
        ],
        Resource = "*"
      }
    ]
  })
}

resource "aws_s3_bucket" "transcripts" {
  bucket = local.transcripts_bucket_name

  tags = {
    Name = "meeting-notes-transcripts"
  }
}

resource "aws_s3_bucket_public_access_block" "transcripts" {
  bucket                  = aws_s3_bucket.transcripts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.app_general.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_versioning" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "transcripts" {
  bucket = aws_s3_bucket.transcripts.id

  rule {
    id     = "abort-mpu"
    status = "Enabled"
    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
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

# Define IAM role for the task (application) permissions
resource "aws_iam_role" "ecs_task_app_role" {
  name = "ecs_task_app_role"

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

# Create IAM policy for DynamoDB access
resource "aws_iam_policy" "dynamodb_access_policy" {
  name        = "meeting-notes-bot-dynamodb-policy"
  description = "Policy for Meeting Notes Bot to access DynamoDB tables"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        Resource = [
          aws_dynamodb_table.subscription_table.arn,
          aws_dynamodb_table.payment_transaction_table.arn,
          aws_dynamodb_table.access_logs_table.arn,
          aws_dynamodb_table.recording_transcript_table.arn,
          aws_dynamodb_table.auto_record_settings_table.arn,
          "${aws_dynamodb_table.auto_record_settings_table.arn}/index/*",
          aws_dynamodb_table.server_context_table.arn,
          aws_dynamodb_table.channel_context_table.arn,
          aws_dynamodb_table.meeting_history_table.arn,
          "${aws_dynamodb_table.meeting_history_table.arn}/index/*"
        ]
      }
    ]
  })
}

# Attach DynamoDB policy to the task role
resource "aws_iam_role_policy_attachment" "ecs_task_dynamodb_policy" {
  role       = aws_iam_role.ecs_task_app_role.name
  policy_arn = aws_iam_policy.dynamodb_access_policy.arn
}

# Temporary belt-and-suspenders: also attach DynamoDB policy to the execution role to avoid AccessDenied
# if tasks start with the execution role due to misconfiguration. Remove once task_role is confirmed in use.
resource "aws_iam_role_policy_attachment" "ecs_task_dynamodb_policy_execution" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.dynamodb_access_policy.arn
}

# KMS permissions for app tasks (and execution role as backup)
resource "aws_iam_policy" "kms_app_policy" {
  name        = "meeting-notes-bot-kms-policy"
  description = "Allow ECS tasks to use the app KMS key"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "AllowKMSForApp"
        Effect = "Allow"
        Action = [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ]
        Resource = aws_kms_key.app_general.arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_kms_policy" {
  role       = aws_iam_role.ecs_task_app_role.name
  policy_arn = aws_iam_policy.kms_app_policy.arn
}

resource "aws_iam_role_policy_attachment" "ecs_task_exec_kms_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.kms_app_policy.arn
}

resource "aws_iam_policy" "transcripts_s3_policy" {
  name        = "meeting-notes-bot-transcripts-s3-policy"
  description = "Allow ECS tasks to upload and read transcripts in the transcripts bucket"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:AbortMultipartUpload",
          "s3:ListBucket"
        ],
        Resource = [
          aws_s3_bucket.transcripts.arn,
          "${aws_s3_bucket.transcripts.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_transcripts_policy" {
  role       = aws_iam_role.ecs_task_app_role.name
  policy_arn = aws_iam_policy.transcripts_s3_policy.arn
}

resource "aws_iam_role_policy_attachment" "ecs_task_exec_transcripts_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = aws_iam_policy.transcripts_s3_policy.arn
}

# Update the ECS task definition to include the execution role ARN
resource "aws_ecs_task_definition" "app_task" {
  family                   = "meeting-notes-bot-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_app_role.arn

  container_definitions = jsonencode([
    {
      name      = "meeting-notes-bot"
      image     = aws_ecr_repository.app_ecr_repo.repository_url
      cpu       = 512
      memory    = 1024
      essential = true
      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
        },
        {
          Action = [
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:ReEncrypt*",
            "kms:GenerateDataKey*",
            "kms:DescribeKey",
          ]
          Effect = "Allow"
          Principal = {
            Service = "ecr.amazonaws.com"
          }
          Resource = "*"
          Sid      = "AllowECR"
        },
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
          name  = "DISCORD_CLIENT_SECRET"
          value = var.DISCORD_CLIENT_SECRET
        },
        {
          name  = "DISCORD_CALLBACK_URL"
          value = var.DISCORD_CALLBACK_URL
        },
        {
          name  = "OAUTH_SECRET"
          value = var.OAUTH_SECRET
        },
        {
          name  = "ENABLE_OAUTH"
          value = var.ENABLE_OAUTH
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
          name  = "OPENAI_ORGANIZATION_ID"
          value = var.OPENAI_ORGANIZATION_ID
        },
        {
          name  = "OPENAI_PROJECT_ID"
          value = var.OPENAI_PROJECT_ID
        },
        {
          name  = "TRANSCRIPTS_BUCKET"
          value = local.transcripts_bucket_name
        },
        {
          name  = "TRANSCRIPTS_PREFIX"
          value = var.TRANSCRIPTS_PREFIX
        },
      ]
      #      healthCheck = {
      #        command     = ["CMD-SHELL", "curl -f http://127.0.0.1:3001/health || exit 1"]
      #        interval    = 30      # seconds
      #        timeout     = 5       # seconds
      #        retries     = 3
      #        startPeriod = 120      # seconds, grace period before health checks start
      #      }
    }
  ])
}

#checkov:skip=CKV_AWS_333 reason: Assigning public IP for now to avoid NAT Gateway cost; will migrate to private subnets with NAT when budget allows.
resource "aws_ecs_service" "app_service" {
  #checkov:skip=CKV_AWS_333 reason: Assigning public IP for now to avoid NAT Gateway cost; will migrate to private subnets with NAT when budget allows.
  name            = "meeting-notes-bot-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app_task.arn
  # COMMENT THIS OUT TO DEPLOY ANY CHNAGES TO THE TASK DEFINITION - SUPER JANK LOL
  #lifecycle {
  #  ignore_changes = [
  #    task_definition
  #  ]
  #}

  enable_execute_command = true

  desired_count = 1
  launch_type   = "FARGATE"

  deployment_controller {
    type = "ECS"
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = [aws_subnet.app_public_subnet_1.id, aws_subnet.app_public_subnet_2.id]
    security_groups  = [aws_security_group.ecs_service_sg.id]
    assign_public_ip = true
  }
}

resource "aws_dynamodb_table" "subscription_table" {
  name         = "SubscriptionTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "UserID"

  attribute {
    name = "UserID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "SubscriptionTable"
  }
}

resource "aws_dynamodb_table" "payment_transaction_table" {
  name         = "PaymentTransactionTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "TransactionID"

  attribute {
    name = "TransactionID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "PaymentTransactionTable"
  }
}

resource "aws_dynamodb_table" "access_logs_table" {
  name         = "AccessLogsTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "AccessLogID"

  attribute {
    name = "AccessLogID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "AccessLogsTable"
  }
}

resource "aws_dynamodb_table" "recording_transcript_table" {
  name         = "RecordingTranscriptTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "MeetingID"

  attribute {
    name = "MeetingID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "RecordingTranscriptTable"
  }
}

resource "aws_dynamodb_table" "auto_record_settings_table" {
  name         = "AutoRecordSettingsTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "guildId"
  range_key    = "channelId"

  attribute {
    name = "guildId"
    type = "S"
  }

  attribute {
    name = "channelId"
    type = "S"
  }

  global_secondary_index {
    name            = "GuildRecordAllIndex"
    hash_key        = "guildId"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "AutoRecordSettingsTable"
  }
}

# Server Context Table
resource "aws_dynamodb_table" "server_context_table" {
  name         = "ServerContextTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "guildId"

  attribute {
    name = "guildId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "ServerContextTable"
  }
}

# Channel Context Table
resource "aws_dynamodb_table" "channel_context_table" {
  name         = "ChannelContextTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "guildId"
  range_key    = "channelId"

  attribute {
    name = "guildId"
    type = "S"
  }

  attribute {
    name = "channelId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "ChannelContextTable"
  }
}

# Meeting History Table
resource "aws_dynamodb_table" "meeting_history_table" {
  name         = "MeetingHistoryTable"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "guildId"
  range_key    = "channelId_timestamp"

  attribute {
    name = "guildId"
    type = "S"
  }

  attribute {
    name = "channelId_timestamp"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  # GSI for querying all meetings in a guild by time
  global_secondary_index {
    name            = "GuildTimestampIndex"
    hash_key        = "guildId"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.app_general.arn
  }

  tags = {
    Name = "MeetingHistoryTable"
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

output "transcripts_bucket_name" {
  value = aws_s3_bucket.transcripts.bucket
}
# Flow logs IAM role
resource "aws_iam_role" "vpc_flow_logs_role" {
  name = "vpc_flow_logs_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = { Service = "vpc-flow-logs.amazonaws.com" },
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "vpc_flow_logs_policy" {
  name = "vpc_flow_logs_policy"
  role = aws_iam_role.vpc_flow_logs_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "logs:CreateLogGroup"
        ],
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
          "logs:DescribeLogGroups"
        ],
        Resource = [
          aws_cloudwatch_log_group.vpc_flow_logs.arn,
          "${aws_cloudwatch_log_group.vpc_flow_logs.arn}:*"
        ]
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/vpc/flow/app-vpc"
  retention_in_days = 365
  kms_key_id        = aws_kms_key.app_general.arn

  tags = {
    Name = "app-vpc-flow-logs"
  }
}

resource "aws_flow_log" "app_vpc_flow" {
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.vpc_flow_logs.arn
  iam_role_arn         = aws_iam_role.vpc_flow_logs_role.arn
  traffic_type         = "ALL"
  vpc_id               = aws_vpc.app_vpc.id
}

# Lock down default security group
resource "aws_default_security_group" "default" {
  vpc_id = aws_vpc.app_vpc.id

  ingress = []
  egress  = []

  tags = {
    Name = "default-sg-locked"
  }
}
