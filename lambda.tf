# This resource runs the build command for our Lambda
resource "null_resource" "build_lambda_get_upload_url" {
  triggers = {
    # This tells Terraform to re-run the build if any source file changes
    source_code_hash = filebase64sha256("${path.module}/src/handlers/get-upload-url.ts")
  }

  provisioner "local-exec" {
    command = "npm run build:get-upload-url"
  }
}

# This zips up the OUTPUT of the build command
data "archive_file" "get_upload_url_zip" {
  # This depends_on block is CRITICAL. It ensures the build runs BEFORE zipping.
  depends_on = [null_resource.build_lambda_get_upload_url]
  
  type        = "zip"
  source_file = "${path.module}/dist/get-upload-url/index.js"
  output_path = "${path.module}/get-upload-url.zip"
}

# Lambda function
resource "aws_lambda_function" "get_upload_url" {
  filename         = data.archive_file.get_upload_url_zip.output_path
  function_name    = "${var.project_name}-get-upload-url"
  role            = aws_iam_role.lambda_role.arn
  handler         = "index.handler"
  runtime         = "nodejs18.x"
  timeout         = 30
  source_code_hash = data.archive_file.get_upload_url_zip.output_base64sha256

  environment {
    variables = {
      UPLOADS_BUCKET_NAME = aws_s3_bucket.uploads.bucket
    }
  }

  tags = {
    Name    = "${var.project_name}-get-upload-url"
    Project = var.project_name
  }
}
