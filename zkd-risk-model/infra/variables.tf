variable "aws_region" {
  type    = string
  default = "ap-south-1" # Mumbai — closest region to the DGCA domestic routes; move if traffic shifts international
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "app_image_tag" {
  description = "Container tag for the zkd-app Fargate service, built by CI and pushed to the ECR repo this module creates."
  type        = string
  default     = "latest"
}

variable "batch_rescore_interval_minutes" {
  description = "How often the batch risk scorer runs across the active-window book. Matches config/risk-thresholds.json forecast.batchRescoreIntervalMs — keep them in sync."
  type        = number
  default     = 10
}

variable "monthly_budget_usd" {
  description = "Hard cost ceiling. AWS Budgets fires the SNS alert (and, past the forecasted-overrun threshold, the Lambda in cost_guard.tf that pauses non-critical scheduled jobs) when this is threatened."
  type        = number
  default     = 1500
}

variable "alert_email" {
  description = "Where budget and scorer-health alarms go."
  type        = string
}

variable "db_instance_class" {
  description = "Single well-provisioned Postgres instance — see documentation/design/04-infrastructure-and-cost.md: do not shard at this scale."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_deletion_protection" {
  description = "Real production default is true (an accidental `terraform destroy`/console delete should not be one command away). A demo/test profile meant to tear down cleanly sets this false — skip_final_snapshot in app.tf is derived from this, since a final snapshot on delete keeps billing indefinitely after destroy otherwise."
  type        = bool
  default     = true
}

variable "db_multi_az" {
  description = "Multi-AZ failover. Off for the demo-week profile to save the standby instance's cost — a demo does not need to survive an AZ failure."
  type        = bool
  default     = true
}

variable "app_desired_count" {
  description = "Fargate task count for zkd-app. Production wants >=2 for the point of externalizing state at all; a demo can run on 1."
  type        = number
  default     = 2
}

variable "app_cpu" {
  type    = string
  default = "1024"
}

variable "app_memory" {
  type    = string
  default = "2048"
}

variable "oag_flight_info_trial_primary_key" {
  description = "Stored in Secrets Manager, never in state or a tfvars file committed to git. Pass via TF_VAR_oag_flight_info_trial_primary_key or a local .auto.tfvars that is gitignored."
  type        = string
  sensitive   = true
}

variable "oag_flight_info_trial_secondary_key" {
  type      = string
  sensitive = true
}
