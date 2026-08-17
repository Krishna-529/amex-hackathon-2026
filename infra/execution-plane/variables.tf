variable "aws_region" {
  type    = string
  default = "ap-south-1" # must match zkd-risk-model/infra's region — this module attaches to that VPC via remote state
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "execute_image_tag" {
  description = "Container tag for the zkd-execute Temporal-worker/saga image, built by CI and pushed to the ECR repo this module creates."
  type        = string
  default     = "latest"
}

variable "execute_cpu" {
  type    = string
  default = "512"
}

variable "execute_memory" {
  type    = string
  default = "1024"
}

variable "opa_image_tag" {
  description = "Tag for the deployed OPA image: NOT the bare openpolicyagent/opa DockerHub image, but a custom image FROM openpolicyagent/opa with policy/*.rego (documentation/design/03-action-policy.md §5's default-deny rules) baked in, built by the same CI pipeline as zkd-execute and pushed to the zkd-opa ECR repo this module creates. A policy change and a worker change ship as one reviewable artifact instead of an EFS mount kept in sync out-of-band."
  type        = string
  default     = "latest"
}

variable "temporal_image_tag" {
  description = "Tag on the public temporalio/auto-setup image (DockerHub, not mirrored into this module's ECR)."
  type        = string
  default     = "latest"
}

variable "monthly_budget_usd" {
  description = "Cost ceiling for the execution plane ONLY. Additive to, not a replacement for, zkd-risk-model/infra/budgets.tf's $1500/mo — see this module's budgets.tf for the combined figure."
  type        = number
  default     = 300
}

variable "alert_email" {
  description = "Where this module's budget alarm goes. Can be the same address as the ML module's var.alert_email."
  type        = string
}

# --- Values the ML module doesn't publish as outputs yet --------------------
# zkd-risk-model/infra/outputs.tf (and the incidental outputs in app.tf,
# scoring.tf, storage.tf) export ECR repos, the VPC, private subnets, the
# budget figure, the ALB DNS name and the DB endpoint — but no security
# group IDs. Rather than guess an ID or reach into that module's state for a
# resource it doesn't publish through outputs.tf, these are passed in
# explicitly. Fold both into network.tf's terraform_remote_state read once
# the ML module adds `output "app_security_group_id"` and
# `output "db_security_group_id"`.

variable "plan_security_group_id" {
  description = "ID of aws_security_group.app from zkd-risk-model/infra/app.tf (the zkd-app / PLAN-plane SG). Needed so the execute plane can admit inbound webhook calls on :8080 and Temporal can admit workflow-start calls on :7233 from zkd-app. Get it with: aws ec2 describe-security-groups --filters Name=group-name,Values=zkd-app-<environment> --query 'SecurityGroups[0].GroupId'"
  type        = string
}

variable "db_security_group_id" {
  description = "ID of aws_security_group.db from zkd-risk-model/infra/app.tf — the shared RDS instance's SG. Used to scope this module's own egress rule toward it. Passing this in does NOT by itself let Temporal reach the database: the DB's own SG must separately admit inbound from Temporal's SG, which this module cannot add without editing the ML module's inline ingress block (risk of two Terraform states fighting over the same SG's rule set) — see plan_opa_sidecar.tf for that proposed diff. Get it with: aws ec2 describe-security-groups --filters Name=group-name,Values=zkd-db-<environment> --query 'SecurityGroups[0].GroupId'"
  type        = string
}

variable "create_temporal_database_now" {
  description = "Opt-in switch for the local-exec psql step in temporal.tf that creates the temporal/temporal_visibility databases on the shared RDS instance. Defaults off — see temporal.tf and README.md for why this isn't attempted unconditionally at apply time (no assumed network path from the Terraform runner to a private-subnet RDS instance, and the master password isn't otherwise wired into this module)."
  type        = bool
  default     = false
}

variable "temporal_db_password" {
  description = "Master password for the shared RDS instance (same value as the ML module's random_password.db / zkd/<environment>/db-password secret). Only read if create_temporal_database_now=true. Never pass via a committed file — export TF_VAR_temporal_db_password in the shell instead."
  type        = string
  sensitive   = true
  default     = ""
}
