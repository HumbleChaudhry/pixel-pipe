resource "null_resource" "build_lambda_get_upload_url" {
  triggers = {
    source_code_hash = filebase64sha256("../src/handlers/get-upload-url.ts")
  }

  provisioner "local-exec" {
    command = "npm run build:get-upload-url"
  }
}

data "archive_file" "get_upload_url_zip" {
  depends_on = [null_resource.build_lambda_get_upload_url]
  
  type        = "zip"
  source_file = "../dist/get-upload-url/index.js"
  output_path = "../get-upload-url.zip"
}

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

# Dispatch tasks Lambda build
resource "null_resource" "build_lambda_dispatch_tasks" {
  triggers = { source_code_hash = filebase64sha256("../src/handlers/dispatch-tasks.ts") }
  provisioner "local-exec" { command = "npm run build:dispatch-tasks" }
}
data "archive_file" "dispatch_tasks_zip" {
  depends_on  = [null_resource.build_lambda_dispatch_tasks]
  type        = "zip"
  source_file = "../dist/dispatch-tasks/index.js"
  output_path = "../dispatch-tasks.zip"
}

# Resize worker Lambda build
resource "null_resource" "build_lambda_resize_worker" {
  triggers = { source_code_hash = filebase64sha256("../src/handlers/resize-worker.ts") }
  provisioner "local-exec" { command = "npm run build:resize-worker" }
}
data "archive_file" "resize_worker_zip" {
  depends_on  = [null_resource.build_lambda_resize_worker]
  type        = "zip"
  source_dir  = "../dist/resize-worker/"
  output_path = "../resize-worker.zip"
  excludes    = ["node_modules/.bin/*"]
}

# Analysis worker Lambda build
resource "null_resource" "build_lambda_analysis_worker" {
  triggers = { source_code_hash = filebase64sha256("../src/handlers/analysis-worker.ts") }
  provisioner "local-exec" { command = "npm run build:analysis-worker" }
}
data "archive_file" "analysis_worker_zip" {
  depends_on  = [null_resource.build_lambda_analysis_worker]
  type        = "zip"
  source_file = "../dist/analysis-worker/index.js"
  output_path = "../analysis-worker.zip"
}

# Lambda functions
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
  timeout          = 60
  memory_size      = 512
  
  environment {
    variables = {
      UPLOADS_BUCKET_NAME   = aws_s3_bucket.uploads.bucket
      PROCESSED_BUCKET_NAME = aws_s3_bucket.processed.bucket
    }
  }
}

resource "aws_lambda_function" "analysis_worker" {
  function_name    = "${var.project_name}-analysis-worker"
  role             = aws_iam_role.analysis_worker_lambda_role.arn
  filename         = data.archive_file.analysis_worker_zip.output_path
  source_code_hash = data.archive_file.analysis_worker_zip.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 60
  memory_size      = 512
  
  environment {
    variables = {
      UPLOADS_BUCKET_NAME = aws_s3_bucket.uploads.bucket
      JOBS_TABLE_NAME     = aws_dynamodb_table.jobs_database.name
    }
  }
}

# Lambda triggers and permissions

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

resource "aws_lambda_event_source_mapping" "analysis_worker_trigger" {
  event_source_arn = aws_sqs_queue.ai_analysis_queue.arn
  function_name    = aws_lambda_function.analysis_worker.arn
}
