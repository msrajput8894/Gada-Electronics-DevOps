# Backup bucket for Gada Electronics.
# Lives in its own Terraform state on purpose: destroying the k3s server must never delete backups.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The bucket name is supplied at init time: terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "backups/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = {
      Project   = "gada-electronics"
      ManagedBy = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  bucket = "gada-backups-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket" "backups" {
  bucket = local.bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  # Keep 30 days of nightly dumps; old versions go a week after they are replaced or deleted.
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}

    expiration {
      days = 30
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

output "bucket" {
  value = aws_s3_bucket.backups.bucket
}
