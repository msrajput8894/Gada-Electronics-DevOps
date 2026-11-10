module "env" {
  source     = "../../modules/gada-env"
  name       = "gada-prod"
  vpc_cidr   = "10.23.0.0/16"
  admin_cidr = var.admin_cidr
}
