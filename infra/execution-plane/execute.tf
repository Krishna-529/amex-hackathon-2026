# The EXECUTE plane. Everything with payment/booking-write credentials lives
# here and nowhere else — documentation/design/03-action-policy.md's ACT
# boundary (§1: "nothing irreversible happens left of ACT") made real at the
# IAM/network layer, not just in application code. Two containers share one
# task (awsvpc mode — they share one ENI, so "localhost" between them is a
# real loopback, never a network hop): `execute` is the Temporal worker plus
# saga activities (§6: reserveVAN -> bookFlight -> bookHotel -> bookGround,
# then terminal disposeOriginal); `opa` is the sidecar policy engine the
# worker calls at localhost:8181 for the default-deny gate in §5. Routing
# the policy check through the sidecar and never through a configurable
# remote OPA URL is what makes "which policy is live" a property of the task
# definition, not something a compromised container could point elsewhere.

resource "aws_ecr_repository" "execute" {
  name                 = "zkd-execute-${var.environment}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # a repo holding a pushed image otherwise blocks `terraform destroy` — see zkd-risk-model/infra/app.tf's identical comment
}

# Custom OPA image: policy/*.rego gets COPY'd into a small image FROM
# openpolicyagent/opa by the same CI pipeline that builds zkd-execute, and
# pushed here — not delivered via a live EFS mount kept in sync out-of-band.
# IMMUTABLE tags for the same reason zkd-risk-model/infra/scoring.tf pins the
# risk-scorer image immutably: a policy rollback should be a tag pin, not a
# rebuild, and a policy that denies bookings is not something to roll forward
# past by accident.
resource "aws_ecr_repository" "opa" {
  name                 = "zkd-opa-${var.environment}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true # see aws_ecr_repository.execute's comment above
}

resource "aws_ecs_cluster" "execute" {
  name = "zkd-execute-${var.environment}"
}

resource "aws_ecs_cluster_capacity_providers" "execute" {
  cluster_name       = aws_ecs_cluster.execute.name
  capacity_providers = ["FARGATE"]
}

# --- Networking: enumerated egress, not 0.0.0.0/0 ---------------------------
# This is the architectural claim from the task made real, in contrast with
# zkd-risk-model/infra/app.tf's aws_security_group.app, which is open egress
# on all ports/protocols to 0.0.0.0/0. Duffel is public SaaS with no AWS
# PrivateLink offering, and Security Groups only match on CIDR block or peer
# SG — never on hostname — so there is no SG-level primitive that pins
# egress to api.duffel.com specifically. Port 443 is opened broadly for that
# one reason alone (see the rule below); every OTHER destination —
# Secrets Manager, CloudWatch Logs, Temporal — is scoped to a specific SG or
# a specific VPC interface endpoint, never to a CIDR block. True
# hostname-level pinning needs AWS Network Firewall (a domain-list rule
# group) in front of the NAT, or a forward proxy; that's the honest next
# step if "port 443 to the internet" ever needs to get tighter than this.
#
# The security groups below are intentionally created bare (no inline
# ingress/egress blocks): execute, temporal and vpc_endpoints all reference
# each other, and inline SG rule blocks that reference a peer SG create a
# same-apply dependency cycle when the reference is mutual. Standalone
# aws_vpc_security_group_{ingress,egress}_rule resources depend on the SGs
# they connect without the SGs themselves depending on each other, so the
# graph stays acyclic.

resource "aws_security_group" "execute" {
  name        = "zkd-execute-${var.environment}"
  description = "zkd-execute (Temporal worker + saga activities + OPA sidecar) — the only task with payment/booking-write credentials"
  vpc_id      = local.vpc_id
}

resource "aws_security_group" "vpc_endpoints" {
  name        = "zkd-vpc-endpoints-${var.environment}"
  description = "Interface endpoints (Secrets Manager, CloudWatch Logs) reachable by the execution plane without a NAT/internet hop"
  vpc_id      = local.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "execute_from_plan" {
  security_group_id           = aws_security_group.execute.id
  description                 = "zkd-app calling the execute-plane webhook/health endpoint"
  from_port                   = 8080
  to_port                     = 8080
  ip_protocol                 = "tcp"
  referenced_security_group_id = var.plan_security_group_id
}

resource "aws_vpc_security_group_egress_rule" "execute_to_temporal" {
  security_group_id            = aws_security_group.execute.id
  description                   = "Temporal frontend — start/query/complete workflow tasks"
  from_port                     = 7233
  to_port                       = 7233
  ip_protocol                   = "tcp"
  referenced_security_group_id  = aws_security_group.temporal.id
}

resource "aws_vpc_security_group_egress_rule" "execute_to_vpc_endpoints" {
  security_group_id            = aws_security_group.execute.id
  description                  = "Secrets Manager + CloudWatch Logs interface endpoints"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.vpc_endpoints.id
}

resource "aws_vpc_security_group_egress_rule" "execute_to_duffel" {
  security_group_id = aws_security_group.execute.id
  description        = "Duffel API (api.duffel.com). SGs can't match on hostname — see the module-level comment above for why this is a port, not a CIDR, that's pinned narrow."
  from_port          = 443
  to_port             = 443
  ip_protocol        = "tcp"
  cidr_ipv4          = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_execute" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  description                  = "Interface-endpoint traffic from the execute plane"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.execute.id
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_temporal" {
  security_group_id            = aws_security_group.vpc_endpoints.id
  description                  = "Interface-endpoint traffic from Temporal"
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.temporal.id
}

resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.private_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}

resource "aws_vpc_endpoint" "logs" {
  vpc_id              = local.vpc_id
  service_name        = "com.amazonaws.${var.aws_region}.logs"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = local.private_subnet_ids
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true
}

# --- IAM ---------------------------------------------------------------
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

resource "aws_iam_role" "execute_task" {
  name               = "zkd-execute-task-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# Reads ONLY execute-secrets — never zkd-risk-model's app-secrets. This is
# the enforcement point for the two-plane credential split: even a buggy or
# compromised execute-plane container cannot reach the PLAN plane's API
# keys, because no IAM statement anywhere grants it.
resource "aws_iam_role_policy" "execute_task" {
  role   = aws_iam_role.execute_task.id
  policy = data.aws_iam_policy_document.read_execute_secrets.json
}

resource "aws_iam_role" "execute_execution" {
  name               = "zkd-execute-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execute_execution" {
  role       = aws_iam_role.execute_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The managed policy above covers ECR pull + log-group write, but NOT
# reading the `secrets` block's values at task-start time — that needs an
# explicit secretsmanager:GetSecretValue grant on the execution role (the
# role ECS assumes before the task role is in the picture). Scoped to
# execute-secrets only — same boundary as the task role above.
resource "aws_iam_role_policy" "execute_execution_secrets" {
  role   = aws_iam_role.execute_execution.id
  policy = data.aws_iam_policy_document.read_execute_secrets.json
}

resource "aws_cloudwatch_log_group" "execute" {
  name              = "/zkd/${var.environment}/execute"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "execute" {
  family                   = "zkd-execute-${var.environment}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.execute_cpu
  memory                   = var.execute_memory
  execution_role_arn       = aws_iam_role.execute_execution.arn
  task_role_arn             = aws_iam_role.execute_task.arn

  container_definitions = jsonencode([
    {
      name         = "execute"
      image        = "${aws_ecr_repository.execute.repository_url}:${var.execute_image_tag}"
      essential    = true
      portMappings = [{ containerPort = 8080, protocol = "tcp" }]
      dependsOn    = [{ containerName = "opa", condition = "START" }]
      environment = [
        { name = "TEMPORAL_ADDRESS", value = "${aws_service_discovery_service.temporal.name}.${aws_service_discovery_private_dns_namespace.internal.name}:7233" },
        { name = "OPA_URL", value = "http://localhost:8181" },
        # Currently unused — zkd-app's actExecutor.ts awaits the Temporal
        # workflow result directly (client.workflow.start().result()) rather
        # than a webhook callback, so RecoveryIntent.callbackUrl is always
        # null today. Kept wired for when/if a webhook path is added. http,
        # not https: the ML module's ALB has no ACM cert on this profile
        # (zkd-risk-model/infra/app.tf's acm_certificate_arn defaults to ""),
        # so only the :80 listener exists — see that module's app_http.
        { name = "CALLBACK_BASE_URL", value = "http://${data.terraform_remote_state.risk_model.outputs.alb_dns_name}" },
      ]
      secrets = [
        { name = "DUFFEL_WRITE_ACCESS_TOKEN", valueFrom = "${aws_secretsmanager_secret.execute_secrets.arn}:DUFFEL_WRITE_ACCESS_TOKEN::" },
        { name = "VPAYMENT_API_KEY", valueFrom = "${aws_secretsmanager_secret.execute_secrets.arn}:VPAYMENT_API_KEY::" },
        { name = "VPAYMENT_ACCOUNT_ID", valueFrom = "${aws_secretsmanager_secret.execute_secrets.arn}:VPAYMENT_ACCOUNT_ID::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.execute.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "execute"
        }
      }
    },
    {
      name      = "opa"
      image     = "${aws_ecr_repository.opa.repository_url}:${var.opa_image_tag}"
      essential = true
      command   = ["run", "--server", "--addr=localhost:8181", "/policy"]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.execute.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "opa"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "execute" {
  name            = "zkd-execute-${var.environment}"
  cluster         = aws_ecs_cluster.execute.id
  task_definition = aws_ecs_task_definition.execute.arn
  desired_count   = 1 # single worker for the finale/demo profile — Temporal task queues make >1 a safe scale-out later, not a redesign
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.execute.id]
    assign_public_ip = false
  }

  # No load_balancer block, deliberately: this plane is not publicly
  # reachable. zkd-app and Temporal are the only callers, both inside the VPC.
}
