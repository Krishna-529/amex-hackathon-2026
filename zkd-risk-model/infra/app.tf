# zkd-app itself. documentation/project/DEPLOYMENT.md is explicit that a
# serverless host breaks the engine (its in-memory setTimeout/setInterval
# chains and Map-based caches need one continuously-running process) — so
# this is long-running Fargate behind an ALB, never Lambda, and the
# in-memory state that isn't already moved to DynamoDB (storage.tf) or
# Postgres here is the next thing to externalize before running >1 task.

resource "aws_ecr_repository" "app" {
  name                 = "zkd-app-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # a repo holding a pushed image otherwise blocks `terraform destroy` — this is a demo/test profile meant to tear down cleanly, not a production image-retention policy
}

resource "aws_ecs_cluster" "app" {
  name = "zkd-app-${var.environment}"
}

resource "aws_ecs_cluster_capacity_providers" "app" {
  cluster_name       = aws_ecs_cluster.app.name
  capacity_providers = ["FARGATE"]
}

resource "aws_security_group" "app" {
  name   = "zkd-app-${var.environment}"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "alb" {
  name   = "zkd-alb-${var.environment}"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    # Only reachable when app_http (no ACM cert) is the active listener —
    # see the acm_certificate_arn default above.
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_lb" "app" {
  name               = "zkd-app-${var.environment}"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "app" {
  name        = "zkd-app-${var.environment}"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
}

resource "aws_lb_listener" "app_https" {
  count             = var.acm_certificate_arn != "" ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# HTTP fallback when no ACM cert is configured yet (var.acm_certificate_arn
# defaults to "") — real production traffic wants the HTTPS listener above
# once a cert exists (DNS-validated, issued out of band); this keeps the
# module applicable for a real-infra smoke test without a domain in hand.
resource "aws_lb_listener" "app_http" {
  count             = var.acm_certificate_arn == "" ? 1 : 0
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app_task" {
  name               = "zkd-app-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "app_task" {
  role = aws_iam_role.app_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # No DynamoDB grant here: zkd-app's store (server/domain/store.ts) is
      # Postgres-backed, not DynamoDB — forecast_cache/alt_cache/inflight_lock
      # exist only for the separate zkd-risk-model scoring Lambda (see
      # scoring.tf), which has its own task role. Granting zkd-app's task
      # write access to tables it never calls was unused privilege, not just
      # unused infra.
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.oag_flight_info.arn, aws_secretsmanager_secret.app_secrets.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = [aws_cloudwatch_event_bus.signals.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${aws_s3_bucket.data_lake.arn}/decision-ledger/*"]
      },
    ]
  })
}

resource "aws_iam_role" "app_execution" {
  name               = "zkd-app-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "app_execution" {
  role       = aws_iam_role.app_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

variable "opa_sidecar_image" {
  description = "zkd-opa ECR image (infra/execution-plane/execute.tf's aws_ecr_repository.opa, e.g. <repo_url>:latest). Empty on first apply — that repo doesn't exist until infra/execution-plane has been applied at least once (see plan_opa_sidecar.tf's proposed-diff comment, now applied for real here rather than left as a proposal). Set it and re-apply once known; the app container works without it (zkd-app's own OPA client fails closed on an unreachable sidecar, same as the execute plane's)."
  type        = string
  default     = ""
}

locals {
  # Static, deterministic Cloud Map DNS name — not `(known after apply)`,
  # since both the namespace and the service name are literals in
  # infra/execution-plane/temporal.tf, not generated IDs. Resolvable once
  # that module is applied and its namespace is associated with this VPC;
  # harmless (just unreachable, and zkd-app's Temporal client connects
  # lazily, only at ACT) if referenced before then.
  temporal_address = "temporal.zkd-execution-plane.local:7233"

  app_containers = concat(
    [{
      name         = "app"
      image        = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment = [
        # package.json's start script now respects $PORT (`next start -p
        # ${PORT:-5176}`) — without this, the container listens on 5176
        # while portMappings/target-group health checks below expect 3000.
        { name = "PORT", value = "3000" },
        { name = "DATABASE_URL", value = "postgres://zkdapp@${aws_db_instance.app.address}:5432/zkdapp" },
        { name = "SIGNAL_EVENT_BUS", value = aws_cloudwatch_event_bus.signals.name },
        { name = "TEMPORAL_ADDRESS", value = local.temporal_address },
        { name = "OPA_URL", value = "http://localhost:8181" },
        # server/decisionLedgerS3.ts mirrors the hash-chained local ledger
        # here on every write — same bucket zkd-risk-model's Lambda path
        # already writes to (see scoring.tf), so both planes' audit trails
        # land in one place. The app degrades to local-JSONL-only if this is
        # ever unset (e.g. local dev), it does not fail closed.
        { name = "DECISION_LEDGER_BUCKET", value = aws_s3_bucket.data_lake.bucket },
        { name = "AWS_REGION", value = var.aws_region },
      ]
      secrets = [
        { name = "SESSION_SECRET", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:SESSION_SECRET::" },
        { name = "DUFFEL_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:DUFFEL_ACCESS_TOKEN::" },
        { name = "GEMINI_API_KEY", valueFrom = "${aws_secretsmanager_secret.app_secrets.arn}:GEMINI_API_KEY::" },
        { name = "DATABASE_PASSWORD", valueFrom = "${aws_secretsmanager_secret.db.arn}:password::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "app"
        }
      }
    }],
    # PLAN-plane OPA sidecar — a cheap early filter only (never the
    # enforcement point; that's the execute plane's own sidecar). See
    # infra/execution-plane/plan_opa_sidecar.tf for the original proposal
    # this makes real. No egress needed beyond the existing 0.0.0.0/0 rule:
    # this sidecar reads a policy bundle baked into its own image and calls
    # nothing external.
    var.opa_sidecar_image != "" ? [{
      name      = "opa"
      image     = var.opa_sidecar_image
      essential = true
      command   = ["run", "--server", "--addr=localhost:8181", "/policy"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "opa"
        }
      }
    }] : []
  )
}

resource "aws_ecs_task_definition" "app" {
  family                   = "zkd-app-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.app_execution.arn
  task_role_arn            = aws_iam_role.app_task.arn

  container_definitions = jsonencode(local.app_containers)
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/zkd/${var.environment}/app"
  retention_in_days = 30
}

resource "aws_ecs_service" "app" {
  name            = "zkd-app-${var.environment}"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.app_desired_count # prod wants >=2 — the whole point of externalizing state to DynamoDB/Postgres is to stop being single-process; demo profile sets 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
}

resource "aws_appautoscaling_target" "app" {
  max_capacity       = max(8, var.app_desired_count)
  min_capacity       = var.app_desired_count
  resource_id        = "service/${aws_ecs_cluster.app.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "app_cpu" {
  name               = "zkd-app-cpu-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    scale_in_cooldown  = 300 # the Dec-2025-IndiGo-style burst is real — don't scale in the instant it subsides
    scale_out_cooldown = 60
  }
}

# --- Postgres: single instance, do not shard -------------------------------
# Per documentation/design/04-infrastructure-and-cost.md's own sizing: ~58
# writes/s average, ~1,157/s at 20x burst — one well-provisioned instance
# absorbs this. Multi-AZ for the failover, not for read scaling.
resource "aws_db_subnet_group" "app" {
  name       = "zkd-app-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "db" {
  name   = "zkd-db-${var.environment}"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port = 5432
    to_port   = 5432
    protocol  = "tcp"
    # zkd-app's own SG, plus (once infra/execution-plane is applied) the
    # Temporal SG it creates — Temporal's `temporal`/`temporal_visibility`
    # databases live on this same shared instance under a different name,
    # see infra/execution-plane/temporal.tf and
    # infra/execution-plane/plan_opa_sidecar.tf's proposed-diff comment for
    # why this is folded into this module's inline block rather than a
    # standalone rule resource fighting a second Terraform state over the
    # same SG.
    security_groups = concat([aws_security_group.app.id], var.additional_db_ingress_sg_ids)
  }
}

variable "additional_db_ingress_sg_ids" {
  description = "Extra security groups admitted to the shared Postgres instance on :5432, beyond aws_security_group.app — e.g. infra/execution-plane's Temporal SG, once that module has been applied and its SG id is known. Empty on first apply (chicken-and-egg: that SG doesn't exist yet); pass it in on a second, targeted apply."
  type        = list(string)
  default     = []
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db" {
  name = "zkd/${var.environment}/db-password"
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id     = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({ password = random_password.db.result })
}

resource "aws_db_instance" "app" {
  identifier              = "zkd-app-${var.environment}"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.db_instance_class
  allocated_storage       = 100
  storage_type            = "gp3"
  db_name                 = "zkdapp"
  username                = "zkdapp"
  password                = random_password.db.result
  db_subnet_group_name    = aws_db_subnet_group.app.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  multi_az                = var.db_multi_az
  backup_retention_period = 7
  deletion_protection     = var.db_deletion_protection
  # A final snapshot otherwise keeps billing (small, but indefinitely, until
  # manually deleted) after `terraform destroy` returns — defeats the whole
  # point of a test-then-destroy demo profile. Production should keep both
  # of these at their protective defaults; see variables.tf.
  skip_final_snapshot = !var.db_deletion_protection
}

variable "acm_certificate_arn" {
  description = "ACM cert for the ALB HTTPS listener — issue in the console/CLI first (DNS validation), then pass the ARN. Empty (default) falls back to a plain HTTP listener on :80, e.g. for a real-infra smoke test with no domain in hand yet."
  type        = string
  default     = ""
}

output "alb_dns_name" { value = aws_lb.app.dns_name }
output "db_endpoint" { value = aws_db_instance.app.address }
