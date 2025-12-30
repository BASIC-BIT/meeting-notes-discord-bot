terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 6.27"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# Create S3 bucket for storing Terraform state
resource "aws_s3_bucket" "terraform_state" {
  bucket = "meeting-notes-terraform-state-bucket"

  tags = {
    Name = "Terraform State Bucket"
  }
}

resource "aws_s3_bucket_ownership_controls" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_acl" "terraform_state" {
  depends_on = [aws_s3_bucket_ownership_controls.terraform_state]
  bucket = aws_s3_bucket.terraform_state.id
  acl = "private"
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Optionally, create a DynamoDB table for state locking
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "meeting-notes-terraform-state-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = {
    Name = "Terraform State Lock Table"
  }
}