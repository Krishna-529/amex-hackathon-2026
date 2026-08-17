# ---------------------------------------------------------------------------
# THIS FILE APPLIES NOTHING. It defines zero resources and is safe to
# `terraform plan`/`apply` in this module as-is — it exists purely to
# document, precisely, an additive change that belongs in the ML team's OWN
# module (zkd-risk-model/infra/app.tf), which this task was explicit that
# this module must not edit. It is a proposal for whoever owns that module
# to apply, not something infra/execution-plane applies on their behalf.
#
# WHY: the PLAN plane (zkd-app) benefits from the same OPA sidecar the
# EXECUTE plane runs — not for the default-deny gate that actually blocks
# spend (that stays in zkd-execute, the only place with payment credentials
# to gate), but for cheap early-filtering: reject an obviously-non-viable
# candidate during WARM (design/03-action-policy.md §1) before it's even
# proposed, without a network round trip to the execute plane. It is
# strictly an optimization — the real, authoritative policy gate the ACT
# boundary depends on is the one in zkd-execute's task (execute.tf), and
# that does not change based on whether this diff is ever applied.
# ---------------------------------------------------------------------------

# --- Diff 1: add an `opa` sidecar container to the existing task -----------
#
# File: zkd-risk-model/infra/app.tf
# Resource: aws_ecs_task_definition.app (currently lines 144-180)
#
# The container_definitions jsonencode([...]) currently contains one object
# (name = "app"). Add a second object to that same list:
#
#   container_definitions = jsonencode([
#     {
#       name = "app"
#       # ...unchanged...
#     },
#     {
#       name      = "opa"
#       image     = "<zkd-opa ECR repo URL>:<opa_image_tag>"  # same image infra/execution-plane/execute.tf builds and pushes to zkd-opa-<environment> — either read it via a terraform_remote_state pointed at THIS module, or duplicate the ECR repo reference; either is a one-line addition, whichever this module's authors prefer once it's applied at least once
#       essential = true
#       command   = ["run", "--server", "--addr=localhost:8181", "/policy"]
#       logConfiguration = {
#         logDriver = "awslogs"
#         options = {
#           "awslogs-group"         = aws_cloudwatch_log_group.app.name  # reuse the existing group; this module already creates it
#           "awslogs-region"        = var.aws_region
#           "awslogs-stream-prefix" = "opa"
#         }
#       }
#     },
#   ])
#
# zkd-app's own code calls http://localhost:8181 for the early-filter check,
# exactly the same way zkd-execute's worker calls its sidecar — see
# execute.tf's OPA_URL env var for the pattern to mirror.

# --- Diff 2: security group egress for aws_security_group.app --------------
#
# File: zkd-risk-model/infra/app.tf (currently lines 22-37)
#
# NO CHANGE NEEDED. aws_security_group.app already egresses 0.0.0.0/0 on all
# ports/protocols, which covers loopback-adjacent container-to-container
# traffic within the task's shared ENI (it never leaves the ENI to need a
# security-group decision at all) and covers nothing new besides — the
# opa sidecar's early-filter check talks to no external endpoint, only to
# `app` over localhost. Documenting this explicitly rather than silently
# assuming it, because the execute-plane's own SG (execute.tf) is built to
# the opposite default (enumerated egress, not 0.0.0.0/0) and it would be
# easy to assume the same tightening was needed here. It is not: the
# plan-plane's OPA sidecar reads a policy bundle baked into its own image
# and makes zero outbound calls, so there is nothing to enumerate.

# --- Also needed, not an OPA-sidecar concern but the same category of
#     change (proposed here, applied by the ML module's owner): -------------
#
# File: zkd-risk-model/infra/app.tf, aws_security_group.db (currently lines
# 238-247)
#
# Temporal (infra/execution-plane/temporal.tf) needs an inbound rule on
# aws_security_group.db admitting its own SG on port 5432, in addition to
# the existing ingress from aws_security_group.app:
#
#   ingress {
#     from_port       = 5432
#     to_port         = 5432
#     protocol        = "tcp"
#     security_groups = [aws_security_group.app.id, <temporal SG ID>]
#   }
#
# This is deliberately NOT applied as a standalone aws_vpc_security_group_ingress_rule
# from this module instead: aws_security_group.db uses an inline `ingress`
# block, and mixing an inline block (authoritative over "its" rule set) with
# a standalone rule resource from a SECOND Terraform state watching the same
# security group is a known source of perpetual plan diffs — each apply
# would fight the other's idea of what belongs there. Folding it into the
# inline block, in the module that owns it, avoids that entirely. Until this
# is applied, infra/execution-plane/temporal.tf's egress rule toward the DB
# (temporal_to_db) is necessary but not sufficient — see README.md.
