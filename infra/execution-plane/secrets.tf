# A NEW secret, deliberately separate from zkd-risk-model's
# zkd/<environment>/app-secrets. The entire point of the two-plane split
# (documentation/design/03-action-policy.md §6 "Execution and rollback",
# documentation/architecture/architecture.md) is that only the execute plane
# holds payment/booking-write credentials — sharing one Secrets Manager
# secret with the read-mostly PLAN plane would undo that boundary at the IAM
# layer even if the app code itself never reaches for it. See execute.tf and
# temporal.tf for the IAM policy documents that make this the ONLY secret
# either task role can read.

resource "aws_secretsmanager_secret" "execute_secrets" {
  name        = "zkd/${var.environment}/execute-secrets"
  description = "Duffel write-scope access token, VPayment/virtual-card issuing keys, and the shared RDS master password (Temporal's Postgres connection, see temporal.tf). Populate out-of-band via `aws secretsmanager put-secret-value`, never a committed tfvars file — see README.md for the exact keys expected."
}

data "aws_iam_policy_document" "read_execute_secrets" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.execute_secrets.arn]
  }
}
