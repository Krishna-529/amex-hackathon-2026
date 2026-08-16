# Hot-reloadable home for config/risk-thresholds.json in production. Ops
# changes a value in the AppConfig console (or `aws appconfig` CLI), starts a
# deployment, and every Fargate task/Lambda picks it up within one poll
# window (lib/thresholds.ts's RELOAD_INTERVAL_MS) — no redeploy, and every
# change is versioned and auditable, which a hand-edited env var is not.

resource "aws_appconfig_application" "zkd" {
  name = "zkd-concierge-${var.environment}"
}

resource "aws_appconfig_environment" "prod" {
  application_id = aws_appconfig_application.zkd.id
  name           = var.environment
}

resource "aws_appconfig_configuration_profile" "thresholds" {
  application_id = aws_appconfig_application.zkd.id
  name           = "risk-thresholds"
  location_uri   = "hosted"
  type           = "AWS.Freeform"

  validator {
    type    = "JSON_SCHEMA"
    content = file("${path.module}/appconfig-threshold-schema.json")
  }
}

resource "aws_appconfig_hosted_configuration_version" "thresholds_initial" {
  application_id           = aws_appconfig_application.zkd.id
  configuration_profile_id = aws_appconfig_configuration_profile.thresholds.configuration_profile_id
  content_type             = "application/json"
  content                  = file("${path.module}/../../zkd-app/config/risk-thresholds.json")
}

resource "aws_appconfig_deployment_strategy" "linear_5min" {
  name                           = "linear-5min-${var.environment}"
  deployment_duration_in_minutes = 5
  growth_factor                  = 100
  growth_type                    = "LINEAR"
  replicate_to                   = "NONE"
  final_bake_time_in_minutes     = 2
}
