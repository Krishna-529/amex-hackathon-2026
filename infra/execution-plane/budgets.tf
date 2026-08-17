# Mirrors zkd-risk-model/infra/budgets.tf's shape (SNS + AWS Budgets, 80%
# forecasted / 100% actual) but scoped to THIS module's spend via a cost
# filter on the Component tag every resource here carries by default (see
# versions.tf's default_tags), and additive to that module's ceiling rather
# than a replacement for it:
#
#   ML module   (zkd-risk-model/infra/budgets.tf): $1500/mo, whole-account
#   This module (infra/execution-plane/budgets.tf):  $300/mo, Component=execution-plane
#   ------------------------------------------------------------------
#   Combined ceiling across both stacks:            $1800/mo
#
# No cost-guard Lambda here, unlike the ML module's. That module can degrade
# gracefully by widening a batch-scorer cadence; this one has no equivalent
# "do less, safely" knob — throttling a saga mid-flight is a correctness
# question (a half-compensated booking is worse than an on-time alert), not
# a cost one, so past 100% actual this only pages a human, deliberately.

resource "aws_sns_topic" "budget_alerts" {
  name = "zkd-execute-budget-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "budget_email" {
  topic_arn = aws_sns_topic.budget_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_budgets_budget" "execution_plane" {
  name         = "zkd-execute-monthly-${var.environment}"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Component$execution-plane"]
  }

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
    subscriber_sns_topic_arns = [aws_sns_topic.budget_alerts.arn]
  }
}
