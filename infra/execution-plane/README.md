# infra/execution-plane — the EXECUTE plane

**Not applied.** This is HCL only, written and `terraform validate`-clean, deliberately not `apply`'d —
see "Applying this" below for why that's a separate, explicitly-confirmed step for whoever picks
this up, not something done as a side effect of writing the module.

## What this is additive to

A new, standalone root module, sitting next to `zkd-risk-model/infra` (the ML/PLAN-plane module)
without editing a single file inside it. It reads that module's outputs via
`data "terraform_remote_state" "risk_model"` (see `network.tf`) — VPC, private subnets, the RDS
endpoint, the ALB DNS name — and attaches new resources to that same VPC rather than building a
second network.

This stands up the EXECUTE side of the two-plane split in
`documentation/design/03-action-policy.md` (§1 "nothing irreversible happens left of ACT") and
`documentation/architecture/architecture.md`: a Temporal worker + saga-activities service
(`zkd-execute`) with its own OPA sidecar and its own Secrets Manager secret, a Temporal server
(`zkd-temporal`) on the same shared RDS instance under a different database, and a budget that's
additive to, not a replacement for, the ML module's $1500/mo ceiling.

| File | What it deploys |
|---|---|
| `network.tf` | Reads the ML module's VPC/subnets/DB-endpoint/ALB-DNS via remote state |
| `secrets.tf` | `zkd/<env>/execute-secrets` — Duffel write-scope token, VPayment keys, shared-RDS password |
| `execute.tf` | `zkd-execute` ECR repo + `zkd-opa` ECR repo, ECS Fargate task (execute + opa containers), dedicated task role, enumerated-egress SG, VPC interface endpoints for Secrets Manager/Logs |
| `temporal.tf` | `zkd-temporal` ECS Fargate service (`temporalio/auto-setup`), Cloud Map service discovery, the one manual DB-creation step |
| `plan_opa_sidecar.tf` | Zero resources — a documented proposal for the ML team's own module (not applied here) |
| `budgets.tf` | $300/mo ceiling (default), tag-scoped, additive to the ML module's $1500/mo |
| `outputs.tf` | ECR repos, service names, SG IDs |

## The two-egress-allowlist claim, and how to verify it

The architectural claim: the execute plane's network egress is **enumerated**, not blanket —
unlike `zkd-risk-model/infra/app.tf`'s `aws_security_group.app`, which egresses `0.0.0.0/0` on all
ports/protocols. `execute.tf`'s `aws_security_group.execute` instead has exactly four egress rules:
Temporal (peer SG, :7233), the Secrets Manager/Logs VPC endpoints (peer SG, :443), and one
necessarily-broad rule to `0.0.0.0/0:443` for Duffel — necessary because AWS security groups have
no hostname-matching primitive, so "api.duffel.com only" cannot be expressed as an SG rule at all
(see the comment at the top of `execute.tf` for the honest next step: AWS Network Firewall's
domain-list rule group, or a forward proxy, if this needs to get tighter than "port 443, not every
port"). `temporal.tf`'s SG has a similar three-rule shape (DB peer SG :5432, VPC-endpoints peer SG
:443, nothing else).

Verify after apply:

```sh
aws ec2 describe-security-groups --group-ids <execute_sg_id output> --query 'SecurityGroups[0].IpPermissionsEgress'
aws ec2 describe-security-groups --group-ids <output of `temporal_service_name`'s SG> --query 'SecurityGroups[0].IpPermissionsEgress'
```

Every entry should show either a `UserIdGroupPairs` peer (not a CIDR) or, for the one Duffel rule,
`0.0.0.0/0` scoped to `FromPort=443, ToPort=443` — never `IpProtocol: "-1"`.

## Populating `execute-secrets` out-of-band

```sh
aws secretsmanager put-secret-value \
  --secret-id zkd/<environment>/execute-secrets \
  --secret-string '{
    "DUFFEL_WRITE_ACCESS_TOKEN": "...",
    "VPAYMENT_API_KEY": "...",
    "VPAYMENT_ACCOUNT_ID": "...",
    "POSTGRES_PWD": "<same value as zkd-risk-model'\''s zkd/<environment>/db-password secret>"
  }'
```

`POSTGRES_PWD` is not a new credential — it's a copy of the ML module's `random_password.db` value
(`aws secretsmanager get-secret-value --secret-id zkd/<environment>/db-password`), duplicated here
rather than granted cross-module IAM access, because that secret belongs to the ML module's task
role boundary and this module intentionally never reads it directly (see `secrets.tf`'s comment on
why `execute-secrets` is a wholly separate secret from `app-secrets`).

## The one manual step: a second database on the shared RDS instance

Terraform's AWS provider has no resource for creating a database *inside* an existing RDS instance
(`aws_db_instance` provisions the instance and its first/only `db_name`; nothing after that).
`temporalio/auto-setup` needs two databases — `temporal` and `temporal_visibility` — on the same
instance `zkd-risk-model/infra/app.tf` already created (`zkdapp`'s master user has `CREATEDB` by
default, so the container's own entrypoint usually self-heals this on first boot — but "usually,
on a shared production instance" is exactly the surprise this module avoids leaving implicit).

Do it once, deliberately, before `zkd-temporal`'s first start:

```sh
PGPASSWORD='<db password>' psql -h <db_endpoint output> -U zkdapp -d zkdapp -c 'CREATE DATABASE temporal'
PGPASSWORD='<db password>' psql -h <db_endpoint output> -U zkdapp -d zkdapp -c 'CREATE DATABASE temporal_visibility'
```

Or set `create_temporal_database_now = true` and `TF_VAR_temporal_db_password`, which runs the
same two statements (idempotently) as a `local-exec` provisioner in `temporal.tf` — off by default,
because it assumes network reachability from wherever `terraform apply` runs to a private-subnet
RDS instance, which is not a safe default assumption for a CI runner.

## Applying this

Not done as part of writing this module — explicitly out of scope for this task. Before anyone
runs `apply`:

1. `zkd-risk-model/infra` must be applied first (this module reads its state via
   `terraform_remote_state`; until then, `plan` here fails on a missing state file — expected, not
   a bug in this module).
2. `var.plan_security_group_id` and `var.db_security_group_id` must be supplied (the ML module
   doesn't export them — see `variables.tf`'s comment for the `aws ec2 describe-security-groups`
   lookup).
3. `zkd-execute` and the custom `zkd-opa` images must be built and pushed to the ECR repos this
   module creates before the ECS service has anything to pull.
4. The manual database step above.
5. Optionally, the ML team applies the proposed diff in `plan_opa_sidecar.tf` (adds a matching OPA
   sidecar to `zkd-app` for cheap early-filtering, and a DB-security-group ingress rule Temporal
   needs) — neither blocks this module's own services from running, but the DB ingress rule does
   block Temporal from actually reaching Postgres until it's applied.
