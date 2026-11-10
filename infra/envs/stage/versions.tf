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
    key          = "stage/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags {
    tags = {
      Project     = "gada-electronics"
      Environment = "stage"
      ManagedBy   = "terraform"
    }
  }
}
