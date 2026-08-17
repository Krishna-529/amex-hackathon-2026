# Storage: the data lake for training/backtest data and the decision ledger,
# the model artifact bucket, and the two DynamoDB tables that replace the
# in-memory Map caches in zkd-app/server/cache.ts and
# zkd-app/server/engine/{forecast,altsCache}.ts once the app runs on more
# than one instance behind the ALB (see app.tf).

resource "aws_s3_bucket" "data_lake" {
  bucket        = "zkd-risk-datalake-${var.environment}"
  force_destroy = true # a non-empty (esp. versioned) bucket otherwise blocks `terraform destroy` — demo/test profile, not a retention policy
}

resource "aws_s3_bucket_lifecycle_configuration" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id
  rule {
    id     = "decision-ledger-archival"
    status = "Enabled"
    filter { prefix = "decision-ledger/" }
    # Off the hot path per documentation/design/04: event bus -> warehouse.
    # Rows go cold within days of the disruption resolving; archive rather
    # than pay hot-tier storage for audit data nobody queries daily.
    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = 180
      storage_class = "GLACIER_IR"
    }
  }
  rule {
    id     = "training-data-ia"
    status = "Enabled"
    filter { prefix = "training-data/" }
    transition {
      days          = 60
      storage_class = "STANDARD_IA"
    }
  }
}

resource "aws_s3_bucket_versioning" "data_lake" {
  bucket = aws_s3_bucket.data_lake.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket" "model_artifacts" {
  bucket        = "zkd-risk-models-${var.environment}"
  force_destroy = true # see aws_s3_bucket.data_lake's comment above
}

resource "aws_s3_bucket_versioning" "model_artifacts" {
  bucket = aws_s3_bucket.model_artifacts.id
  versioning_configuration { status = "Enabled" } # every training run's artifact is retrievable — a bad deploy is one S3 object-version rollback, not a retrain
}

# --- Live forecast cache -----------------------------------------------
# One row per (flightId), TTL'd. Replaces server/engine/forecast.ts's
# module-level `inFlight`/staleness Map so five app instances behind the ALB
# share one forecast instead of five independent ones.
resource "aws_dynamodb_table" "forecast_cache" {
  name         = "zkd-forecast-cache-${var.environment}"
  billing_mode = "PAY_PER_REQUEST" # spiky, event-driven traffic — provisioned capacity would sit idle most of the day
  hash_key     = "flightId"

  attribute {
    name = "flightId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  point_in_time_recovery { enabled = true }
}

# --- Alternative-flight pre-cache ---------------------------------------
# Written only when the batch/event scorer crosses config/risk-thresholds.json
# altCache.prefetchAtOrAbove for a flight — see scoring.tf. This is the table
# that makes "search for alternatives before the cancellation, not after"
# actually cheap: the WARM reshop runs once per risk-crossing event, not once
# per page view.
resource "aws_dynamodb_table" "alt_cache" {
  name         = "zkd-alt-cache-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "flightId"

  attribute {
    name = "flightId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# --- Distributed "in-flight request" lock -------------------------------
# Reproduces the single-process `inFlight` Map (server/engine/forecast.ts,
# altsCache.ts) across Fargate tasks: a conditional put with a short TTL is
# the cross-instance equivalent of "concurrent callers share one request."
resource "aws_dynamodb_table" "inflight_lock" {
  name         = "zkd-inflight-lock-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "lockKey"

  attribute {
    name = "lockKey"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

output "data_lake_bucket" { value = aws_s3_bucket.data_lake.bucket }
output "model_artifacts_bucket" { value = aws_s3_bucket.model_artifacts.bucket }
output "forecast_cache_table" { value = aws_dynamodb_table.forecast_cache.name }
output "alt_cache_table" { value = aws_dynamodb_table.alt_cache.name }
