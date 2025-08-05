resource "aws_dynamodb_table" "jobs_database" {
  name           = "${var.project_name}-jobs-database"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "imageId"

  attribute {
    name = "imageId"
    type = "S"
  }

  tags = {
    Name    = "${var.project_name}-jobs-database"
    Project = var.project_name
  }
}
