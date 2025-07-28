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

# --- Build/Zip for dispatch-tasks Lambda ---
resource "null_resource" "build_lambda_dispatch_tasks" {
  triggers = { source_code_hash = filebase64sha256("${path.module}/src/handlers/dispatch-tasks.ts") }
  provisioner "local-exec" { command = "npm run build:dispatch-tasks" }
}
data "archive_file" "dispatch_tasks_zip" {
  depends_on  = [null_resource.build_lambda_dispatch_tasks]
  type        = "zip"
  source_file = "${path.module}/dist/dispatch-tasks/index.js"
  output_path = "${path.module}/dispatch-tasks.zip"
}

# --- Build/Zip for resize-worker Lambda ---
resource "null_resource" "build_lambda_resize_worker" {
  triggers = { source_code_hash = filebase64sha256("${path.module}/src/handlers/resize-worker.ts") }
  provisioner "local-exec" { command = "npm run build:resize-worker" }
}
data "archive_file" "resize_worker_zip" {
  depends_on  = [null_resource.build_lambda_resize_worker]
  type        = "zip"
  source_file = "${path.module}/dist/resize-worker/index.js"
  output_path = "${path.module}/resize-worker.zip"
}

# --- Lambda Function Definitions ---
resource "aws_lambda_function" "dispatch_tasks" {
  function_name    = "${var.project_name}-dispatch-tasks"
  role             = aws_iam_role.dispatch_tasks_lambda_role.arn
  filename         = data.archive_file.dispatch_tasks_zip.output_path
  source_code_hash = data.archive_file.dispatch_tasks_zip.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  
  environment {
    variables = {
      SNS_TOPIC_ARN = aws_sns_topic.image_events.arn
    }
  }
}

resource "aws_lambda_function" "resize_worker" {
  function_name    = "${var.project_name}-resize-worker"
  role             = aws_iam_role.resize_worker_lambda_role.arn
  filename         = data.archive_file.resize_worker_zip.output_path
  source_code_hash = data.archive_file.resize_worker_zip.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  # Add environment variables here as needed later
}

# --- Lambda Triggers & Permissions ---

resource "aws_lambda_permission" "allow_s3_to_invoke_dispatcher" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dispatch_tasks.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.uploads.arn
}

resource "aws_lambda_event_source_mapping" "resize_worker_trigger" {
  event_source_arn = aws_sqs_queue.resize_queue.arn
  function_name    = aws_lambda_function.resize_worker.arn
}
