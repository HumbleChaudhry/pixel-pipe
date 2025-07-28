# S3 bucket for uploads
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.project_name}-uploads-${var.unique_suffix}"

  tags = {
    Name    = "${var.project_name}-uploads-${var.unique_suffix}"
    Project = var.project_name
  }
}

# S3 bucket for processed images
resource "aws_s3_bucket" "processed" {
  bucket = "${var.project_name}-processed-${var.unique_suffix}"

  tags = {
    Name    = "${var.project_name}-processed-${var.unique_suffix}"
    Project = var.project_name
  }
}

# Block public access for uploads bucket
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Block public access for processed bucket
resource "aws_s3_bucket_public_access_block" "processed" {
  bucket = aws_s3_bucket.processed.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning for uploads bucket
resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Versioning for processed bucket
resource "aws_s3_bucket_versioning" "processed" {
  bucket = aws_s3_bucket.processed.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption for uploads bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Server-side encryption for processed bucket
resource "aws_s3_bucket_server_side_encryption_configuration" "processed" {
  bucket = aws_s3_bucket.processed.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CORS configuration for uploads bucket
resource "aws_s3_bucket_cors_configuration" "uploads_cors" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"] # Allows any headers to be sent
    allowed_methods = ["PUT", "POST", "GET"] # CRITICAL: We must allow PUT
    # CRITICAL FIX: Only allow uploads from your known frontends
    allowed_origins = [
      "http://localhost:3000", 
      "https://${aws_cloudfront_distribution.frontend_distribution.domain_name}"
    ]
    expose_headers  = ["ETag"] # Allows the browser to read the ETag header from the response
    max_age_seconds = 3000 # How long the browser can cache this "permission slip"
  }
}

# --- Frontend Hosting Infrastructure ---

resource "aws_s3_bucket" "frontend" {
  bucket = "${var.project_name}-frontend-${var.unique_suffix}"
  
  tags = {
    Name    = "${var.project_name}-frontend"
    Project = var.project_name
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "frontend_policy" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect    = "Allow",
        Principal = {
          AWS = aws_cloudfront_origin_access_identity.oai.iam_arn
        },
        Action   = "s3:GetObject",
        Resource = "${aws_s3_bucket.frontend.arn}/*"
      }
    ]
  })
}

resource "aws_s3_bucket_notification" "uploads_notification" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.dispatch_tasks.arn
    events              = ["s3:ObjectCreated:*"]
  }
}
