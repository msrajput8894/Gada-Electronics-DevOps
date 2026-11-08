output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "data_security_group_id" {
  value = aws_security_group.data.id
}

output "app_public_ip" {
  value = aws_instance.app.public_ip
}

output "data_public_ip" {
  value = aws_instance.data.public_ip
}

output "data_private_ip" {
  value = aws_instance.data.private_ip
}
