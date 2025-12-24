resource "aws_ce_cost_category" "chronote_project" {
  count        = var.environment == "prod" ? 1 : 0
  name         = "${var.project_name}-project"
  rule_version = "CostCategoryExpression.v1"

  rules = [
    {
      value = var.project_name
      rule = {
        tags = {
          key    = "Project"
          values = [var.project_name]
        }
      }
    }
  ]

  default_value = "other"
}

resource "aws_ce_cost_category" "chronote_environment" {
  count        = var.environment == "prod" ? 1 : 0
  name         = "${var.project_name}-environment"
  rule_version = "CostCategoryExpression.v1"

  rules = [
    {
      value = "prod"
      rule = {
        tags = {
          key    = "Environment"
          values = ["prod", "production"]
        }
      }
    },
    {
      value = "staging"
      rule = {
        tags = {
          key    = "Environment"
          values = ["staging", "stage"]
        }
      }
    }
  ]

  default_value = "other"
}
