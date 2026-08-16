# infra/ — deployable AWS Terraform

Real, `terraform validate`-clean Terraform (validated 2026-08-14 against provider `hashicorp/aws
~> 5.60`). No AWS credentials exist in the environment this was authored in, so it has not been
`apply`'d or cost-verified against a live account — that is the one thing only you can do next.

## Budget reality: hold off until demo week

The AWS budget for this project is a **$140 credit**, not the always-on production spend in
`documentation/design/04-infrastructure-and-cost.md`. Plan:

- **Now → one week before the final presentation: `terraform plan` only.** Never `apply`. Iterate
  on the code, review the plan output, catch mistakes for free.
- **One week out: `terraform apply` with `terraform.tfvars.demo.example`** (copy to
  `terraform.tfvars.demo`, gitignored) — sized for roughly $25-35/week, leaving headroom under
  $140 for OAG overage and a few rehearsal apply/destroy cycles. See that file for the line-item
  estimate and exactly which knobs it turns down (single AZ, 1 Fargate task, `db.t4g.micro`,
  wider batch cadence).
- **Immediately after the demo: `terraform destroy`.** Do not leave it running — an idle NAT
  gateway and ALB alone burn ~$13/week for nothing.
- `budgets.tf`'s `monthly_budget_usd` (set to 100 in the demo tfvars) is a real backstop
  underneath the plan above, not a replacement for it: it pages you at 80% forecast and
  auto-degrades the scoring cadence at 100% actual, in case a rehearsal run is left on longer
  than intended.

## What this stands up

| File | What it deploys |
|---|---|
| `networking.tf` | 2-AZ VPC, one NAT gateway (cost lever, see below) |
| `storage.tf` | S3 data lake + model-artifact bucket, 3 DynamoDB tables (forecast cache, alt cache, cross-instance in-flight lock) |
| `secrets.tf` | Secrets Manager for the OAG dual-key pair and other supplier keys |
| `scoring.tf` | Batch risk-scorer Lambda (container image, scheduled) + event-driven rescorer Lambda + EventBridge bus |
| `training.tf` | Weekly retrain as a Fargate Spot ECS task (no standing SageMaker endpoint) |
| `app.tf` | zkd-app on Fargate behind an ALB, RDS Postgres (single instance, Multi-AZ), autoscaling 2→8 tasks |
| `appconfig.tf` | AWS AppConfig hosting of `zkd-app/config/risk-thresholds.json` for hot-reload without redeploy |
| `budgets.tf` | AWS Budgets monthly ceiling + a Lambda that degrades cadence automatically at 100% actual spend |

## Apply

```sh
cd zkd-risk-model/infra
terraform init
export TF_VAR_oag_flight_info_trial_primary_key="<from Secrets Manager or your OAG portal, never a committed file>"
export TF_VAR_oag_flight_info_trial_secondary_key="<...>"
export TF_VAR_alert_email="you@example.com"
export TF_VAR_acm_certificate_arn="arn:aws:acm:..."   # issue in ACM console first, DNS-validated
zip -j lambda/cost_guard.zip lambda/cost_guard.py
terraform plan
terraform apply
```

Then build and push the three container images (`ecr_app_repo`, `ecr_scorer_repo`,
`ecr_trainer_repo` outputs) before the ECS service and scheduled Lambdas have anything to run —
see `zkd-risk-model/README.md` for what each image contains.

## Cost levers, in the order they actually matter

1. **`batch_rescore_interval_minutes`** (default 10) — the batch scorer's cost scales directly
   with this. Widening it is the single biggest lever, and is exactly what `budgets.tf`'s
   cost-guard Lambda does automatically at 100% of budget.
2. **Single NAT gateway** (`networking.tf`) — one shared NAT instead of one per AZ. A real
   availability tradeoff, taken deliberately; revisit if it becomes the bottleneck.
3. **DynamoDB on-demand, not provisioned** — traffic is bursty (disruption events cluster), so
   idle provisioned capacity would be pure waste.
4. **Fargate Spot for training** (`training.tf`) — training is retryable, so Spot's interruption
   risk costs nothing but a delayed retry.
5. **S3 lifecycle rules** (`storage.tf`) — decision-ledger data moves to Infrequent Access at 30
   days, Glacier Instant Retrieval at 180. It is audit data, not a hot path.
6. **No standing inference endpoint** — the batch/event Lambda pair replaces what a SageMaker
   real-time endpoint would cost 24/7 for a workload that is genuinely intermittent.

## Honest gaps

- **Not applied.** This is real IaC, not a running system. `terraform plan` against your account
  is the next real step, and it may need account-specific tweaks (service quotas, existing VPC
  peering, an ACM cert you already have).
- **Container images referenced, not built here.** `scoring.tf`/`training.tf`/`app.tf` point at
  ECR repos this module creates; the Dockerfiles and the Python/Node source those images run live
  in `zkd-risk-model/` and `zkd-app/` respectively — build and push before first apply, or the
  Lambdas/ECS tasks will fail to pull `:latest`.
- **OAG Flight Info Alerts** (the push mechanism `scoring.tf`'s event bus is shaped for) requires
  moving off the trial subscription — see `zkd-risk-model/README.md` §OAG integration. Until then,
  the event-driven rescorer has no real trigger wired to it; the batch scorer is the only signal
  path actually live on trial-tier keys.
- **Cost estimate is not yet a bill.** `documentation/design/04-infrastructure-and-cost.md`'s
  $750–2,000/mo order-of-magnitude (at ~50k monitored trips/month) is the right ballpark for this
  shape of infrastructure; the enterprise flight-status/alerts contract, not this Terraform, is
  what actually swings the real number.
