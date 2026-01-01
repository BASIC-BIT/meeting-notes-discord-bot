variable "REDIS_URL" {
  description = "Optional Redis URL for cache storage"
  type        = string
  default     = ""
}

variable "REDIS_AUTH_TOKEN" {
  description = "Auth token for the managed Redis cluster"
  type        = string
  sensitive   = true
}

locals {
  redis_auth_token         = trimspace(var.REDIS_AUTH_TOKEN)
  redis_auth_token_encoded = urlencode(local.redis_auth_token)
  redis_auth_prefix = local.redis_auth_token_encoded != "" ? ":${local.redis_auth_token_encoded}@" : ""
  redis_url = var.REDIS_URL != "" ? var.REDIS_URL : "rediss://${local.redis_auth_prefix}${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"
}

resource "aws_elasticache_subnet_group" "redis_subnet_group" {
  name       = "${local.name_prefix}-redis-subnet-group"
  subnet_ids = [aws_subnet.app_public_subnet_1.id, aws_subnet.app_public_subnet_2.id]
}

resource "aws_security_group" "redis_sg" {
  description = "Redis SG for ${local.name_prefix}"
  vpc_id      = aws_vpc.app_vpc.id

  ingress {
    description     = "Allow Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service_sg.id]
  }

  egress {
    description = "Allow outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [aws_vpc.app_vpc.cidr_block]
  }

  tags = {
    Name = "redis-sg"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  #checkov:skip=CKV2_AWS_50 reason: Single-node Redis for now to keep costs low; enable Multi-AZ when required.
  replication_group_id          = "${local.name_prefix}-redis"
  description                   = "Redis cache for ${local.name_prefix}"        
  engine                        = "redis"
  engine_version                = "7.0"
  node_type                     = "cache.t3.micro"
  num_cache_clusters            = 1
  port                          = 6379
  parameter_group_name          = "default.redis7"
  subnet_group_name             = aws_elasticache_subnet_group.redis_subnet_group.name
  security_group_ids            = [aws_security_group.redis_sg.id]
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  auth_token                    = local.redis_auth_token
  automatic_failover_enabled    = false
  multi_az_enabled              = false
  kms_key_id                    = aws_kms_key.app_general.arn
}
