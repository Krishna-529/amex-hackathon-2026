# Where the model actually runs. Per documentation/design/04-infrastructure-and-cost.md's
# own framing (which the built model keeps, it just stops being hypothetical):
# gradient-boosted trees on tabular features are a CPU workload. No GPU, no
# always-on inference endpoint — a batch Lambda on a schedule, plus a
# thin event-driven Lambda for material signal changes, both scored against
# the same model artifact pulled from S3.

resource "aws_ecr_repository" "risk_scorer" {
  name                 = "zkd-risk-scorer-${var.environment}"
  image_tag_mutability = "IMMUTABLE" # a model rollback is a tag pin, not a rebuild
  force_delete         = true        # see aws_ecr_repository.app's comment in app.tf
}

data "aws_iam_policy_document" "scorer_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scorer" {
  name               = "zkd-risk-scorer-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.scorer_assume.json
}

data "aws_iam_policy_document" "scorer_permissions" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query",
    ]
    resources = [
      aws_dynamodb_table.forecast_cache.arn,
      aws_dynamodb_table.alt_cache.arn,
      aws_dynamodb_table.inflight_lock.arn,
    ]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.model_artifacts.arn}/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.data_lake.arn}/decision-ledger/*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.oag_flight_info.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.aws_region}:*:*"]
  }
}

resource "aws_iam_role_policy" "scorer" {
  role   = aws_iam_role.scorer.id
  policy = data.aws_iam_policy_document.scorer_permissions.json
}

resource "aws_iam_role_policy_attachment" "scorer_vpc_access" {
  role       = aws_iam_role.scorer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# --- Batch scorer ---------------------------------------------------------
# Re-scores every flight in the active window (departing within 72h — the
# same burst window the Dec-2025-IndiGo sizing in documentation/design/04
# uses) on a fixed cadence. This is the cost-controlled default: cadence is
# a config knob (var.batch_rescore_interval_minutes), not a per-poll cost.
resource "aws_lambda_function" "batch_scorer" {
  function_name = "zkd-risk-batch-scorer-${var.environment}"
  role          = aws_iam_role.scorer.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.risk_scorer.repository_url}:latest"
  image_config { command = ["handler.batch_score"] }
  timeout     = 300
  memory_size = 1536 # xgboost inference over a few hundred flights is CPU-bound, not memory-bound; sized for the cold-start container unpack, not the workload

  environment {
    variables = {
      MODEL_BUCKET           = aws_s3_bucket.model_artifacts.bucket
      FORECAST_TABLE         = aws_dynamodb_table.forecast_cache.name
      ALT_CACHE_TABLE        = aws_dynamodb_table.alt_cache.name
      INFLIGHT_LOCK_TABLE    = aws_dynamodb_table.inflight_lock.name
      DECISION_LEDGER_BUCKET = aws_s3_bucket.data_lake.bucket
      OAG_SECRET_ARN         = aws_secretsmanager_secret.oag_flight_info.arn
      THRESHOLD_CONFIG_URL   = aws_appconfig_configuration_profile.thresholds.configuration_profile_id
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.scorer.id]
  }
}

resource "aws_security_group" "scorer" {
  name   = "zkd-risk-scorer-${var.environment}"
  vpc_id = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"] # outbound to OAG/NOAA/Open-Meteo/AWS APIs only; no inbound rule exists
  }
}

resource "aws_scheduler_schedule" "batch_scorer" {
  name       = "zkd-risk-batch-scorer-${var.environment}"
  group_name = "default"

  flexible_time_window { mode = "OFF" }
  schedule_expression = "rate(${var.batch_rescore_interval_minutes} minutes)"

  target {
    arn      = aws_lambda_function.batch_scorer.arn
    role_arn = aws_iam_role.scheduler_invoke.arn
  }
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler_invoke" {
  name               = "zkd-scheduler-invoke-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  role = aws_iam_role.scheduler_invoke.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = [aws_lambda_function.batch_scorer.arn, aws_lambda_function.event_scorer.arn]
    }]
  })
}

# --- Event-driven rescorer -------------------------------------------------
# Fires only on a MATERIAL signal: an OAG Flight Info Alert (schedule change /
# cancellation, once the account is off trial and Alerts is provisioned — see
# infra/README.md), or an upstream-leg delay big enough to threaten this
# flight's rotation. Debounced per flight so a chatty upstream feed cannot
# turn into a re-score storm — see eventRescoreDebounceMs in
# config/risk-thresholds.json, enforced via the inflight_lock table.
resource "aws_lambda_function" "event_scorer" {
  function_name = "zkd-risk-event-scorer-${var.environment}"
  role          = aws_iam_role.scorer.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.risk_scorer.repository_url}:latest"
  image_config { command = ["handler.event_score"] }
  timeout     = 30
  memory_size = 1024

  environment {
    variables = {
      MODEL_BUCKET        = aws_s3_bucket.model_artifacts.bucket
      FORECAST_TABLE      = aws_dynamodb_table.forecast_cache.name
      ALT_CACHE_TABLE     = aws_dynamodb_table.alt_cache.name
      INFLIGHT_LOCK_TABLE = aws_dynamodb_table.inflight_lock.name
      OAG_SECRET_ARN      = aws_secretsmanager_secret.oag_flight_info.arn
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.scorer.id]
  }
}

resource "aws_cloudwatch_event_bus" "signals" {
  name = "zkd-flight-signals-${var.environment}"
}

resource "aws_cloudwatch_event_rule" "material_signal" {
  event_bus_name = aws_cloudwatch_event_bus.signals.name
  name           = "material-signal-${var.environment}"
  event_pattern = jsonencode({
    "detail-type" = ["schedule-change", "cancellation-signal", "upstream-rotation-delay"]
  })
}

resource "aws_cloudwatch_event_target" "event_scorer" {
  event_bus_name = aws_cloudwatch_event_bus.signals.name
  rule           = aws_cloudwatch_event_rule.material_signal.name
  arn            = aws_lambda_function.event_scorer.arn
}

resource "aws_lambda_permission" "eventbridge_invoke" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.event_scorer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.material_signal.arn
}

output "signal_event_bus_name" { value = aws_cloudwatch_event_bus.signals.name }
