output "api_gateway_url" {
  description = "URL of the API Gateway"
  value       = "${aws_api_gateway_stage.prod.invoke_url}/get-upload-url"
}

output "cloudfront_url" {
  description = "The URL for the CloudFront distribution"
  value       = "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.frontend_distribution.id
}

output "github_actions_role_arn" {
  description = "The ARN of the IAM role for GitHub Actions"
  value       = aws_iam_role.github_actions_deploy_role.arn
}