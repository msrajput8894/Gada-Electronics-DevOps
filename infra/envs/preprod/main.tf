module "env" {
  source     = "../../modules/gada-env"
  name       = "gada-preprod"
  vpc_cidr   = "10.22.0.0/16"
  admin_cidr = var.admin_cidr
}
