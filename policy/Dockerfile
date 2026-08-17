# The custom OPA image infra/execution-plane/execute.tf expects at
# `zkd-opa-<environment>` — policy/*.rego baked in at build time, not
# delivered via a live-synced mount, so a policy change and a worker change
# ship as one reviewable, immutable-tagged artifact (see execute.tf's
# comment on aws_ecr_repository.opa's IMMUTABLE tag policy).
FROM openpolicyagent/opa:latest
COPY execute.rego execute_test.rego /policy/
