# Attaches to the ML module's VPC/subnets rather than building a second
# network — one execution plane per risk-model deployment, not a parallel
# environment. zkd-risk-model/infra has no backend block (local state, see
# its versions.tf), so this reads that module's state file straight off
# disk. Until that module has been applied at least once, this data source
# has nothing to read — see README.md for what that looks like.

data "terraform_remote_state" "risk_model" {
  backend = "local"
  config = {
    path = "${path.module}/../../zkd-risk-model/infra/terraform.tfstate"
  }
}

locals {
  vpc_id             = data.terraform_remote_state.risk_model.outputs.vpc_id
  private_subnet_ids = data.terraform_remote_state.risk_model.outputs.private_subnet_ids
  db_endpoint        = data.terraform_remote_state.risk_model.outputs.db_endpoint
}
