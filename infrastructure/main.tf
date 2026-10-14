

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "pixel-pipe-tf-state-humblec17" 
    key            = "global/s3/terraform.tfstate"
    region         = "ca-central-1"
    dynamodb_table = "pixel-pipe-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = "ca-central-1"
}