#!/usr/bin/env bash
# Usage: gada-deploy <image-tag>
# Switches the app to a new image tag, smoke-tests it, and rolls back if it fails.
set -euo pipefail

DIR=/opt/gada-app
NEW="${1:?usage: gada-deploy <image-tag>}"
cd "$DIR"
OLD=$(grep '^APP_VERSION=' .env | cut -d= -f2)

deploy() {
  echo "APP_VERSION=$1" > .env.tmp && mv .env.tmp .env \
    && docker compose pull app \
    && docker compose up -d --wait --wait-timeout 90
}

smoke() {
  local v
  v=$(curl -fsS --max-time 5 http://127.0.0.1/health | jq -r .version) || return 1
  [ "$v" = "$1" ] && curl -fsS --max-time 5 http://127.0.0.1/ready > /dev/null
}

if [ "$NEW" = "$OLD" ]; then
  echo "already running $NEW"
  exit 0
fi

echo "deploying $NEW (was $OLD)"
if deploy "$NEW" && smoke "$NEW"; then
  logger -t gada-deploy "deployed $NEW (was $OLD)"
  echo "deployed $NEW"
else
  echo "deploy of $NEW FAILED, rolling back to $OLD" >&2
  deploy "$OLD" || echo "rollback to $OLD also failed" >&2
  logger -t gada-deploy "rolled back $NEW to $OLD"
  exit 1
fi
