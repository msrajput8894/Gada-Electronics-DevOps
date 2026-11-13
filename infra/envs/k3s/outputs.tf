output "public_ip" {
  value = aws_instance.k3s.public_ip
}

output "ssh_command" {
  value = "ssh -i ~/.ssh/gada-key.pem ubuntu@${aws_instance.k3s.public_ip}"
}

output "fetch_kubeconfig" {
  value = "ssh -i ~/.ssh/gada-key.pem ubuntu@${aws_instance.k3s.public_ip} 'sudo cat /etc/rancher/k3s/k3s.yaml' | sed 's/127.0.0.1/${aws_instance.k3s.public_ip}/' > ~/.kube/k3s-config"
}
