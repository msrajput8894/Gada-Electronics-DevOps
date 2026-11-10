module "env" {
  source     = "../../modules/gada-env"
  name       = "gada-stage"
  vpc_cidr   = "10.21.0.0/16"
  admin_cidr = var.admin_cidr
}
