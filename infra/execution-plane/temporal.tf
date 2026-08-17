# Temporal server — the workflow engine zkd-execute's worker (execute.tf)
# polls for saga tasks (design/03-action-policy.md §6: reserveVAN ->
# bookFlight -> bookHotel -> bookGround, with each compensation registered
# before its side effect runs). One more Fargate service on the
# execution-plane cluster, reusing the ML module's existing RDS instance
# rather than standing up a second Postgres — design/04-infrastructure-and-cost.md's
# own sizing argument ("one well-provisioned instance, do not shard") applies
# just as much to Temporal's small event-history workload as it does to
# zkd-app's. Different database name (`temporal`, not `zkdapp`) on that same
# instance — see the null_resource at the bottom of this file for the one
# manual step Terraform cannot do for itself.

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "zkd-execution-plane.local"
  vpc  = local.vpc_id
}

resource "aws_service_discovery_service" "temporal" {
  name = "temporal"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_security_group" "temporal" {
  name        = "zkd-temporal-${var.environment}"
  description = "Temporal server — reachable only from the execute plane and the plan plane, both inside the VPC; no public exposure"
  vpc_id      = local.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "temporal_from_execute" {
  security_group_id            = aws_security_group.temporal.id
  description                  = "Execute-plane worker starting/completing/querying workflows"
  from_port                    = 7233
  to_port                      = 7233
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.execute.id
}

resource "aws_vpc_security_group_ingress_rule" "temporal_from_plan" {
  security_group_id            = aws_security_group.temporal.id
  description                  = "Plan-plane (zkd-app) starting a saga workflow after ACT"
  from_port                    = 7233
  to_port                      = 7233
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.plan_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "temporal_to_db" {
  security_group_id            = aws_security_group.temporal.id
  description                  = "Shared RDS instance (zkd-risk-model/infra/app.tf's aws_db_instance.app), different DB name. This rule only permits traffic FROM this SG's side — the DB's own SG still needs an inbound rule admitting the temporal SG, which this module does not add (see plan_opa_sidecar.tf's proposed diff)."
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = var.db_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "temporal_to_vpc_endpoints" {
  security_group_id            = aws_security_group.temporal.id
  description                  = "Secrets Manager + CloudWatch Logs interface endpoints"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
}

data "aws_iam_policy_document" "temporal_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "temporal_task" {
  name               = "zkd-temporal-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.temporal_assume.json
}
# No inline policy: the Temporal server container calls no AWS APIs beyond
# what the execution role already covers below (ECR pull, log write, DB
# password read). Kept as its own role rather than reusing execute_task so a
# permission this service needs later never has to be reasoned about
# alongside the execute plane's payment-credential boundary.

resource "aws_iam_role" "temporal_execution" {
  name               = "zkd-temporal-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.temporal_assume.json
}

resource "aws_iam_role_policy_attachment" "temporal_execution" {
  role       = aws_iam_role.temporal_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "temporal_execution_secrets" {
  role   = aws_iam_role.temporal_execution.id
  policy = data.aws_iam_policy_document.read_execute_secrets.json # same secret holds the shared Postgres master password used below — see secrets.tf
}

resource "aws_cloudwatch_log_group" "temporal" {
  name              = "/zkd/${var.environment}/temporal"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "temporal" {
  family                   = "zkd-temporal-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.temporal_execution.arn
  task_role_arn            = aws_iam_role.temporal_task.arn

  container_definitions = jsonencode([{
    name         = "temporal"
    image        = "temporalio/auto-setup:${var.temporal_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 7233, protocol = "tcp" }]
    environment = [
      { name = "DB", value = "postgresql" },
      { name = "DB_PORT", value = "5432" },
      { name = "POSTGRES_SEEDS", value = local.db_endpoint },
      { name = "POSTGRES_USER", value = "zkdapp" }, # same master user zkd-risk-model/infra/app.tf's aws_db_instance.app was created with
      { name = "DBNAME", value = "temporal" },
      { name = "VISIBILITY_DBNAME", value = "temporal_visibility" }, # auto-setup's visibility store — a second DB it also expects, alongside `temporal` itself; see README.md
    ]
    secrets = [
      { name = "POSTGRES_PWD", valueFrom = "${aws_secretsmanager_secret.execute_secrets.arn}:POSTGRES_PWD::" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.temporal.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "temporal"
      }
    }
  }])
}

resource "aws_ecs_service" "temporal" {
  name            = "zkd-temporal-${var.environment}"
  cluster         = aws_ecs_cluster.execute.id # shared execution-plane cluster with zkd-execute — two purpose-scoped services, one cluster, same pattern as zkd-risk-model/infra/training.tf's dedicated cluster over reusing zkd-app's
  task_definition = aws_ecs_task_definition.temporal.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.temporal.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.temporal.arn
  }
}

# --- The one thing this module cannot self-serve ----------------------------
# auto-setup's entrypoint runs `CREATE DATABASE temporal` / `temporal_visibility`
# on first boot if they don't already exist AND the connecting user has
# CREATE DATABASE (RDS Postgres master users get that by default, so this
# *should* self-heal on first task start). "Should", on a shared production
# instance, is exactly the kind of surprise this module avoids leaving
# implicit: Terraform's AWS provider has no `aws_rds_database` resource for
# creating a database inside an existing instance, so this is offered as an
# explicit, opt-in, versioned step rather than something that happens
# silently the first time the ECS service starts.
resource "null_resource" "create_temporal_databases" {
  count = var.create_temporal_database_now ? 1 : 0

  # NOT wired to run automatically on every apply — it needs network
  # reachability to the RDS instance (private subnets only: run this from a
  # host inside the VPC, or via an SSM port-forward session) and the master
  # password (TF_VAR_temporal_db_password). If that path isn't available,
  # run the equivalent two `CREATE DATABASE` statements by hand — see
  # README.md. This resource exists so the step is versioned and repeatable
  # when it IS run, not so it happens implicitly.
  provisioner "local-exec" {
    command = <<-EOT
      PGPASSWORD='${var.temporal_db_password}' psql -h ${local.db_endpoint} -U zkdapp -d zkdapp -tAc "SELECT 1 FROM pg_database WHERE datname='temporal'" | grep -q 1 || \
        PGPASSWORD='${var.temporal_db_password}' psql -h ${local.db_endpoint} -U zkdapp -d zkdapp -c 'CREATE DATABASE temporal'
      PGPASSWORD='${var.temporal_db_password}' psql -h ${local.db_endpoint} -U zkdapp -d zkdapp -tAc "SELECT 1 FROM pg_database WHERE datname='temporal_visibility'" | grep -q 1 || \
        PGPASSWORD='${var.temporal_db_password}' psql -h ${local.db_endpoint} -U zkdapp -d zkdapp -c 'CREATE DATABASE temporal_visibility'
    EOT
  }

  triggers = {
    db_endpoint = local.db_endpoint
  }
}
