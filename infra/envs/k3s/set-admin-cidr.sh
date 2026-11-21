#!/usr/bin/env bash
# Sets admin_cidr in terraform.tfvars to this machine's current public IP (/32).
# Run it before terraform apply whenever your home IP may have changed.
set -euo pipefail
cd "$(dirname "$0")"

ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
[[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || { echo "Unexpected answer from checkip: '$ip'"; exit 1; }

old="$(sed -n 's/^admin_cidr *= *"\(.*\)"/\1/p' terraform.tfvars 2>/dev/null || true)"
if [ -f terraform.tfvars ] && grep -q '^admin_cidr' terraform.tfvars; then
  sed -i "s|^admin_cidr.*|admin_cidr = \"${ip}/32\"|" terraform.tfvars
else
  printf 'admin_cidr = "%s/32"\n' "$ip" >> terraform.tfvars
fi
echo "admin_cidr: ${old:-<not set>} -> ${ip}/32"
