# Real cost ceiling, not an aspiration. AWS Budgets fires at 80% of forecast
# spend (early warning) and, at 100% of actual spend, invokes a Lambda that
# widens the batch-scorer interval and disables the event-driven rescorer's
# EventBridge rule — degrading gracefully to the same "warm-candidates-only,
# less lead time" posture documentation/design/01-prediction-model.md
# already describes for badly-calibrated hold conversion, rather than
# an unbounded bill.

resource "aws_sns_topic" "budget_alerts" {
  name = "zkd-budget-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "budget_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_budgets_budget" "monthly" {
  name         = "zkd-monthly-${var.environment}"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn, aws_sns_topic.cost_guard_trigger.arn]
  }
}

resource "aws_sns_topic" "cost_guard_trigger" {
  name = "zkd-cost-guard-${var.environment}"
}

resource "aws_lambda_function" "cost_guard" {
  function_name = "zkd-cost-guard-${var.environment}"
  role          = aws_iam_role.cost_guard.arn
  runtime       = "python3.12"
  handler       = "cost_guard.handler"
  timeout       = 30
  filename      = "${path.module}/lambda/cost_guard.zip" # zip src/cost_guard.py before apply — see infra/README.md
  environment {
    variables = {
      SCHEDULE_ARN          = aws_scheduler_schedule.batch_scorer.arn
      EVENT_RULE_NAME       = aws_cloudwatch_event_rule.material_signal.name
      EVENT_BUS_NAME        = aws_cloudwatch_event_bus.signals.name
      DEGRADED_INTERVAL_MIN = "30" # widen from the configured cadence to this when cost-guarded
    }
  }
}

resource "aws_sns_topic_subscription" "cost_guard" {
  topic_arn = aws_sns_topic.cost_guard_trigger.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.cost_guard.arn
}

resource "aws_lambda_permission" "cost_guard_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cost_guard.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.cost_guard_trigger.arn
}

data "aws_iam_policy_document" "cost_guard_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cost_guard" {
  name               = "zkd-cost-guard-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.cost_guard_assume.json
}

resource "aws_iam_role_policy" "cost_guard" {
  role = aws_iam_role.cost_guard.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["scheduler:UpdateSchedule", "scheduler:GetSchedule"]
        Resource = [aws_scheduler_schedule.batch_scorer.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["events:DisableRule", "events:DescribeRule"]
        Resource = [aws_cloudwatch_event_rule.material_signal.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["arn:aws:logs:${var.aws_region}:*:*"]
      },
    ]
  })
}
