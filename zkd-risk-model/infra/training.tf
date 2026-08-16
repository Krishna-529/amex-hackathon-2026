# Retrain pipeline: a scheduled Fargate Spot task, not a standing SageMaker
# endpoint or notebook. Per documentation/design/04's own framing: training
# is occasional (weekly retrain + nightly backtest against yesterday's
# resolved outcomes), gradient-boosted trees on tabular data train in
# minutes on CPU, and Spot is fine because a training run is fully retryable
# — nothing is lost by losing the instance mid-run except time.

resource "aws_ecs_cluster" "training" {
  name = "zkd-training-${var.environment}"
}

resource "aws_ecs_cluster_capacity_providers" "training" {
  cluster_name       = aws_ecs_cluster.training.name
  capacity_providers = ["FARGATE_SPOT", "FARGATE"]
}

resource "aws_ecr_repository" "trainer" {
  name                 = "zkd-risk-trainer-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # see aws_ecr_repository.app's comment in app.tf
}

data "aws_iam_policy_document" "trainer_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "trainer_task" {
  name               = "zkd-trainer-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.trainer_assume.json
}

resource "aws_iam_role_policy" "trainer_task" {
  role = aws_iam_role.trainer_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
        Resource = [aws_s3_bucket.data_lake.arn, "${aws_s3_bucket.data_lake.arn}/*", aws_s3_bucket.model_artifacts.arn, "${aws_s3_bucket.model_artifacts.arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.oag_flight_info.arn]
      },
    ]
  })
}

resource "aws_iam_role" "trainer_execution" {
  name               = "zkd-trainer-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.trainer_assume.json
}

resource "aws_iam_role_policy_attachment" "trainer_execution" {
  role       = aws_iam_role.trainer_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "retrain" {
  family                   = "zkd-risk-retrain-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "2048" # 2 vCPU — a few million rows of gradient-boosted training is minutes, not hours, on CPU
  memory                   = "8192"
  execution_role_arn       = aws_iam_role.trainer_execution.arn
  task_role_arn            = aws_iam_role.trainer_task.arn

  container_definitions = jsonencode([{
    name      = "retrain"
    image     = "${aws_ecr_repository.trainer.repository_url}:latest"
    essential = true
    environment = [
      { name = "DATA_LAKE_BUCKET", value = aws_s3_bucket.data_lake.bucket },
      { name = "MODEL_BUCKET", value = aws_s3_bucket.model_artifacts.bucket },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.trainer.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "retrain"
      }
    }
  }])
}

resource "aws_cloudwatch_log_group" "trainer" {
  name              = "/zkd/${var.environment}/trainer"
  retention_in_days = 90
}

# Weekly retrain, using accumulated real outcomes (AviationStack/OAG-observed
# status vs. what was predicted) as the growing label set — see
# zkd-risk-model/README.md "continual learning loop". FARGATE_SPOT only:
# capacity-provider strategy below has no on-demand fallback because a missed
# week degrades to "yesterday's model", never to no model.
resource "aws_scheduler_schedule" "weekly_retrain" {
  name       = "zkd-weekly-retrain-${var.environment}"
  group_name = "default"
  flexible_time_window { mode = "OFF" }
  schedule_expression = "cron(0 3 ? * SUN *)" # 03:00 UTC Sunday — off the daytime traffic peak for every served region

  target {
    arn      = aws_ecs_cluster.training.arn
    role_arn = aws_iam_role.scheduler_ecs.arn
    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.retrain.arn
      capacity_provider_strategy {
        capacity_provider = "FARGATE_SPOT" # retryable batch job — a reclaimed Spot task just reruns next window
        weight            = 1
      }
      network_configuration {
        subnets          = aws_subnet.private[*].id
        security_groups  = [aws_security_group.scorer.id]
        assign_public_ip = false
      }
    }
    # Catches Scheduler-level failures to even START the task (IAM, capacity,
    # subnet exhaustion) after its built-in retries — see monitoring.tf's
    # alarm on this queue's depth. Does NOT catch the training script itself
    # exiting non-zero once the task is running; that's the EventBridge rule
    # in monitoring.tf watching ECS Task State Change events instead.
    dead_letter_config {
      arn = aws_sqs_queue.retrain_dlq.arn
    }
  }
}

resource "aws_sqs_queue" "retrain_dlq" {
  name                      = "zkd-retrain-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days — long enough to notice a missed week before the queue drops it
}

data "aws_iam_policy_document" "retrain_dlq_policy" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.retrain_dlq.arn]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_sqs_queue_policy" "retrain_dlq" {
  queue_url = aws_sqs_queue.retrain_dlq.id
  policy    = data.aws_iam_policy_document.retrain_dlq_policy.json
}

data "aws_iam_policy_document" "scheduler_ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler_ecs" {
  name               = "zkd-scheduler-ecs-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.scheduler_ecs_assume.json
}

resource "aws_iam_role_policy" "scheduler_ecs" {
  role = aws_iam_role.scheduler_ecs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ecs:RunTask"
      Resource = aws_ecs_task_definition.retrain.arn
      }, {
      Effect   = "Allow"
      Action   = "iam:PassRole"
      Resource = [aws_iam_role.trainer_task.arn, aws_iam_role.trainer_execution.arn]
    }]
  })
}
