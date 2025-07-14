terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ca-central-1" 
}

variable "project_name" {
  description = "pixel-pipe"
  type        = "string"
  default     = "pixel-pipe"
}

variable "unique_suffix" {
  description = "A unique suffix for globally unique resources like S3 buckets"
  type        = "string"
  default     = "humblec17" 
}