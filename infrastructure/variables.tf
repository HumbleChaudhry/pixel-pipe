variable "project_name" {
  description = "pixel-pipe"
  type        = string
  default     = "pixel-pipe"
}

variable "unique_suffix" {
  description = "A unique suffix for globally unique resources like S3 buckets"
  type        = string
  default     = "humblec17"
}
