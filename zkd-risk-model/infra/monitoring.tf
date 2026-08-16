# Real CloudWatch alarms and a dashboard for the prediction pipeline —
# documentation/design/05-cancellation-risk-model.md's design claims
# thresholds are "pageable via CloudWatch if it regresses"; this is the
# resource that makes that claim true instead of aspirational. Costs nothing
# until `terraform apply` (see infra/README.md's demo-week timing), and
# alarms reuse the SNS topic budgets.tf already wires to a real email
# subscriber, rather than standing up a second notification path.

# --- Batch scorer: the cadence that actually keeps predictions dynamic ----
resource "aws_cloudwatch_metric_alarm" "batch_scorer_errors" {
  alarm_name          = "zkd-batch-scorer-errors-${var.environment}"
  alarm_description   = "Batch risk-scorer Lambda is failing invocations — predictions stop refreshing on schedule."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.batch_scorer.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching" # no invocations yet (pre-first-schedule-fire) is not a failure
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
  ok_actions          = [aws_sns_topic.budget_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "batch_scorer_duration" {
  alarm_name          = "zkd-batch-scorer-duration-${var.environment}"
  alarm_description   = "Batch scorer p_max duration approaching its 300s timeout — the active-window book is at risk of a partial sweep."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  dimensions          = { FunctionName = aws_lambda_function.batch_scorer.function_name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 240000 # 80% of the 300000ms timeout set in scoring.tf
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "batch_scorer_throttles" {
  alarm_name          = "zkd-batch-scorer-throttles-${var.environment}"
  alarm_description   = "Batch scorer is being throttled — real concurrency limit hit."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = aws_lambda_function.batch_scorer.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
}

# --- Event scorer: the material-signal path ---------------------------------
resource "aws_cloudwatch_metric_alarm" "event_scorer_errors" {
  alarm_name          = "zkd-event-scorer-errors-${var.environment}"
  alarm_description   = "Event-driven rescorer is failing — a material signal (schedule change / cancellation / rotation delay) isn't producing a fresh score."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.event_scorer.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
}

# --- Training: a real retrain that never completes is worse than a stale
# model nobody notices went stale. Two real, distinct failure modes, each
# with its own real signal — a scheduled ecs:RunTask has no CloudWatch
# metric of its own, so neither is guessable from a single metric alarm:
#
# 1. The Scheduler couldn't even START the task (IAM, capacity, subnet
#    exhaustion) — training.tf's dead_letter_config on the schedule target
#    catches this after Scheduler's built-in retries; alarm on queue depth.
# 2. The task started but the training script itself exited non-zero —
#    only a real ECS Task State Change event (STOPPED, non-zero exit code)
#    can see this, so route it directly to the same SNS topic rather than
#    trying to fake it as a metric threshold.
resource "aws_cloudwatch_metric_alarm" "retrain_dlq_depth" {
  alarm_name          = "zkd-retrain-dlq-depth-${var.environment}"
  alarm_description   = "Weekly retrain task failed to even start (Scheduler retries exhausted) — check IAM/capacity/subnets."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.retrain_dlq.name }
  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.budget_alerts.arn]
}

resource "aws_cloudwatch_event_rule" "retrain_task_failed" {
  name        = "zkd-retrain-task-failed-${var.environment}"
  description = "Weekly retrain Fargate task ran but the training script itself exited non-zero."
  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.training.arn]
      lastStatus = ["STOPPED"]
      stopCode   = ["EssentialContainerExited"]
      containers = {
        exitCode = [{ "anything-but" = 0 }]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "retrain_task_failed" {
  rule = aws_cloudwatch_event_rule.retrain_task_failed.name
  arn  = aws_sns_topic.budget_alerts.arn
}

resource "aws_sns_topic_policy" "allow_eventbridge" {
  arn = aws_sns_topic.budget_alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "SNS:Publish"
      Resource  = aws_sns_topic.budget_alerts.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.retrain_task_failed.arn } }
    }]
  })
}

# --- Dashboard: the one screen an on-call person actually needs -----------
resource "aws_cloudwatch_dashboard" "prediction_pipeline" {
  dashboard_name = "zkd-prediction-pipeline-${var.environment}"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = {
          title = "Batch scorer — invocations / errors"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.batch_scorer.function_name],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.batch_scorer.function_name],
          ]
          period = 300, stat = "Sum", region = var.aws_region
        }
      },
      {
        type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = {
          title   = "Batch scorer — duration (ms)"
          metrics = [["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.batch_scorer.function_name]]
          period  = 300, stat = "Maximum", region = var.aws_region
        }
      },
      {
        type = "metric", x = 0, y = 6, width = 12, height = 6,
        properties = {
          title = "Event scorer — invocations / errors"
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.event_scorer.function_name],
            ["AWS/Lambda", "Errors", "FunctionName", aws_lambda_function.event_scorer.function_name],
          ]
          period = 300, stat = "Sum", region = var.aws_region
        }
      },
      {
        type = "metric", x = 12, y = 6, width = 12, height = 6,
        properties = {
          title = "Forecast cache — consumed capacity (real dynamism, visible)"
          metrics = [
            ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", aws_dynamodb_table.forecast_cache.name],
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", aws_dynamodb_table.forecast_cache.name],
          ]
          period = 300, stat = "Sum", region = var.aws_region
        }
      },
    ]
  })
}

output "dashboard_url" {
  value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home?region=${var.aws_region}#dashboards:name=${aws_cloudwatch_dashboard.prediction_pipeline.dashboard_name}"
}
