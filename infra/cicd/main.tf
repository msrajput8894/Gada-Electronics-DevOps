variable "github_repo" {
  description = "owner/repo exactly as GitHub spells it"
  type        = string
  default     = "msrajput8894@114761457/Gada-Electronics-DevOps@1445887428"
}

locals {
  environments = toset(["stage", "preprod", "prod"])
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Who may assume the role: this repo's workflows, running in the GitHub environment of the same name.
data "aws_iam_policy_document" "trust" {
  for_each = local.environments

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:environment:${each.key}"]
    }
  }
}

# What the role may do: run shell commands, only on servers tagged with its own environment.
data "aws_iam_policy_document" "deploy" {
  for_each = local.environments

  statement {
    sid       = "RunCommandsOnThisEnvironmentOnly"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/Environment"
      values   = [each.key]
    }
  }

  statement {
    sid       = "UseTheShellDocument"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${data.aws_region.current.region}::document/AWS-RunShellScript"]
  }

  statement {
    sid = "ReadResults"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:DescribeInstanceInformation",
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "deploy" {
  for_each           = local.environments
  name               = "gada-deploy-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.trust[each.key].json
}

resource "aws_iam_role_policy" "deploy" {
  for_each = local.environments
  name     = "deploy"
  role     = aws_iam_role.deploy[each.key].id
  policy   = data.aws_iam_policy_document.deploy[each.key].json
}

output "deploy_role_arns" {
  value = { for env, role in aws_iam_role.deploy : env => role.arn }
}
