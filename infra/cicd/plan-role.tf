# Read-only role for "terraform plan" on pull requests.
# Trusted only for pull_request runs of this repo, and it can read but never change anything.

data "aws_iam_policy_document" "plan_trust" {
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
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name                 = "gada-terraform-plan"
  assume_role_policy   = data.aws_iam_policy_document.plan_trust.json
  max_session_duration = 3600
}

# Describe/read everything, so plan can refresh the real infrastructure and the state file.
resource "aws_iam_role_policy_attachment" "plan_read_only" {
  role       = aws_iam_role.plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

# Reading is broad, but these stay off limits: backup contents and secret values.
data "aws_iam_policy_document" "plan_deny" {
  statement {
    sid       = "NoBackupContents"
    effect    = "Deny"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = ["arn:aws:s3:::gada-backups-${data.aws_caller_identity.current.account_id}/*"]
  }

  statement {
    sid       = "NoSecretValues"
    effect    = "Deny"
    actions   = ["secretsmanager:GetSecretValue", "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "plan_deny" {
  name   = "deny-sensitive-reads"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan_deny.json
}

output "plan_role_arn" {
  value = aws_iam_role.plan.arn
}
