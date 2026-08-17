output "ecr_execute_repo" { value = aws_ecr_repository.execute.repository_url }
output "ecr_opa_repo" { value = aws_ecr_repository.opa.repository_url }
output "execute_service_name" { value = aws_ecs_service.execute.name }
output "temporal_service_name" { value = aws_ecs_service.temporal.name }
output "execute_sg_id" { value = aws_security_group.execute.id }
output "temporal_sg_id" { value = aws_security_group.temporal.id }

# plan_sg_id: NOT actually sourced from remote state — the ML module doesn't
# export aws_security_group.app's ID (see variables.tf's comment on
# var.plan_security_group_id). Echoed here so downstream consumers of this
# module's outputs have one place to look, but the value itself still
# originates from the operator-supplied variable, not from
# data.terraform_remote_state.risk_model. Fold into network.tf once the ML
# module publishes it.
output "plan_sg_id" { value = var.plan_security_group_id }
