resource "aws_sns_topic" "image_events" {
    name = "${var.project_name}-image-events"
    tags = {
        Name = "${var.project_name}-image-events"
        Project = var.project_name
    }
}