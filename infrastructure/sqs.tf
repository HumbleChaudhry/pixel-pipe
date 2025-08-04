resource "aws_sqs_queue" "resize_queue" {
    name = "${var.project_name}-resize-queue"
    tags = {
        Name = "${var.project_name}-resize-queue"
        Project = var.project_name
    }
}

#SNS topic linking to SQS queue
resource "aws_sns_topic_subscription" "resize_queue_subscription" {
    topic_arn = aws_sns_topic.image_events.arn
    protocol = "sqs"
    endpoint = aws_sqs_queue.resize_queue.arn
}


resource "aws_sqs_queue_policy" "resize_queue_policy" {
  queue_url = aws_sqs_queue.resize_queue.id
  policy    = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = "*",
        Action    = "sqs:SendMessage",
        Resource  = aws_sqs_queue.resize_queue.arn,
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_sns_topic.image_events.arn
          }
        }
      }
    ]
  })
}