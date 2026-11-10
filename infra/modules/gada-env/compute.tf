# Ubuntu 22.04 on purpose: MongoDB 8.0 refuses to start on kernels 6.19 and newer,
# and Ubuntu 24.04's current AWS kernel is newer than that.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd*/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.app_instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.app.id]
  key_name               = var.key_name
  iam_instance_profile   = aws_iam_instance_profile.server.name

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 10
    encrypted   = true
  }

  tags = {
    Name = "${var.name}-app"
    Role = "app"
  }

  # A newer Ubuntu image appearing later must not replace a running server.
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_instance" "data" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.data_instance_type
  subnet_id              = aws_subnet.public[1].id
  vpc_security_group_ids = [aws_security_group.data.id]
  key_name               = var.key_name
  iam_instance_profile   = aws_iam_instance_profile.server.name

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 10
    encrypted   = true
  }

  tags = {
    Name = "${var.name}-data"
    Role = "data"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}
