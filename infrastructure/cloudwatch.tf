# CloudWatch Dashboard for PixelPipe monitoring
resource "aws_cloudwatch_dashboard" "pixelpipe_dashboard" {
  dashboard_name = "PixelPipe-Dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["PixelPipe", "ImagesProcessed", "WorkerName", "resize-worker"],
            [".", ".", ".", "analysis-worker"]
          ]
          view    = "timeSeries"
          stacked = false
          region  = "ca-central-1"
          title   = "Images Processed by Worker"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["PixelPipe", "ProcessingFailures", "WorkerName", "resize-worker"],
            [".", ".", ".", "analysis-worker"]
          ]
          view    = "timeSeries"
          stacked = false
          region  = "ca-central-1"
          title   = "Processing Failures by Worker"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.resize_worker.function_name],
            [".", ".", ".", aws_lambda_function.analysis_worker.function_name],
            [".", ".", ".", aws_lambda_function.dispatch_tasks.function_name],
            [".", ".", ".", aws_lambda_function.get_upload_url.function_name]
          ]
          view    = "timeSeries"
          stacked = false
          region  = "ca-central-1"
          title   = "Lambda Invocations"
          period  = 300
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6

        properties = {
          metrics = [
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.resize_worker.function_name],
            [".", ".", ".", aws_lambda_function.analysis_worker.function_name],
            [".", ".", ".", aws_lambda_function.dispatch_tasks.function_name],
            [".", ".", ".", aws_lambda_function.get_upload_url.function_name]
          ]
          view    = "timeSeries"
          stacked = false
          region  = "ca-central-1"
          title   = "Lambda Errors"
          period  = 300
        }
      }
    ]
  })
}

# CloudWatch Alarm for DLQ messages
resource "aws_cloudwatch_metric_alarm" "resize_queue_dlq_alarm" {
  alarm_name          = "${var.project_name}-resize-queue-dlq-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = "60"
  statistic           = "Average"
  threshold           = "0"
  alarm_description   = "This metric monitors messages in the resize queue DLQ"

  dimensions = {
    QueueName = aws_sqs_queue.resize_queue_dlq.name
  }

  tags = {
    Name    = "${var.project_name}-resize-queue-dlq-alarm"
    Project = var.project_name
  }
}

# CloudWatch Alarm for resize-worker Lambda errors
resource "aws_cloudwatch_metric_alarm" "resize_worker_errors_alarm" {
  alarm_name          = "${var.project_name}-resize-worker-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "1"
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = "300"
  statistic           = "Sum"
  threshold           = "1"
  alarm_description   = "This metric monitors errors in the resize-worker Lambda function"

  dimensions = {
    FunctionName = aws_lambda_function.resize_worker.function_name
  }

  tags = {
    Name    = "${var.project_name}-resize-worker-errors-alarm"
    Project = var.project_name
  }
}
