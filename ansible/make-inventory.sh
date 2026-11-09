#!/usr/bin/env bash
# Builds inventory/hosts.ini from Terraform outputs. IPs change on every apply, so never commit the result.
set -euo pipefail
cd "$(dirname "$0")/../infra/envs/lab"
APP_IP=$(terraform output -raw app_public_ip)
DATA_IP=$(terraform output -raw data_public_ip)
mkdir -p ../../../ansible/inventory
cat > ../../../ansible/inventory/hosts.ini <<INV
[app]
gada-app ansible_host=${APP_IP}

[data]
gada-data ansible_host=${DATA_IP}

[all:vars]
ansible_user=ubuntu
ansible_ssh_private_key_file=~/.ssh/gada-key.pem
INV
echo "Wrote ansible/inventory/hosts.ini"
