output "ecr_app_repo" { value = aws_ecr_repository.app.repository_url }
output "ecr_scorer_repo" { value = aws_ecr_repository.risk_scorer.repository_url }
output "ecr_trainer_repo" { value = aws_ecr_repository.trainer.repository_url }
output "vpc_id" { value = aws_vpc.main.id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "monthly_budget_usd" { value = var.monthly_budget_usd }
