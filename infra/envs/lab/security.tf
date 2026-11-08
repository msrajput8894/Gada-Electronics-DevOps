resource "aws_security_group" "app" {
  name        = "${var.name}-app"
  description = "App server: web and SSH from the admin IP only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name}-app-sg" }
}

resource "aws_security_group" "data" {
  name        = "${var.name}-data"
  description = "Data server: SSH from the admin IP, MongoDB from the app server only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name}-data-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "app_http" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP from the admin IP (open to the internet later, with TLS)"
}

resource "aws_vpc_security_group_ingress_rule" "app_ssh" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  description       = "SSH from the admin IP"
}

resource "aws_vpc_security_group_ingress_rule" "data_ssh" {
  security_group_id = aws_security_group.data.id
  cidr_ipv4         = var.admin_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  description       = "SSH from the admin IP"
}

resource "aws_vpc_security_group_ingress_rule" "data_mongo" {
  security_group_id            = aws_security_group.data.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 27017
  to_port                      = 27017
  description                  = "MongoDB from the app server only"
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound traffic (package installs, image pulls)"
}

resource "aws_vpc_security_group_egress_rule" "data_all" {
  security_group_id = aws_security_group.data.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  description       = "Outbound traffic (package installs, image pulls)"
}
