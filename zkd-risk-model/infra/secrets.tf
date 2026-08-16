# OAG ships every product as a primary/secondary key pair specifically so one
# can be rotated live while the other keeps serving — Secrets Manager stores
# both under one secret so server/oag.ts's rotate-on-401/403/429 logic can
# read them atomically instead of racing two separate secrets.

resource "aws_secretsmanager_secret" "oag_flight_info" {
  name        = "zkd/${var.environment}/oag-flight-info"
  description = "OAG Flight Info API dual-key pair (trial today; swap to production keys in-place once OAG_FLIGHT_INFO_PRIMARY_KEY/SECONDARY_KEY go live — see .env.example)."
}

resource "aws_secretsmanager_secret_version" "oag_flight_info" {
  secret_id = aws_secretsmanager_secret.oag_flight_info.id
  secret_string = jsonencode({
    primary   = var.oag_flight_info_trial_primary_key
    secondary = var.oag_flight_info_trial_secondary_key
  })
}

# Placeholders for the other supplier keys the app needs (Duffel, LiteAPI,
# Gemini, MyCa, ...) — created empty so the secret ARNs are stable and IAM
# policies can reference them from day one; fill values out-of-band via
# `aws secretsmanager put-secret-value`, never through a committed tfvars file.
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "zkd/${var.environment}/app-secrets"
  description = "Duffel, LiteAPI, Gemini, MyCa, session-signing and other application keys. Populate out-of-band."
}

data "aws_iam_policy_document" "read_app_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.oag_flight_info.arn,
      aws_secretsmanager_secret.app_secrets.arn,
    ]
  }
}
