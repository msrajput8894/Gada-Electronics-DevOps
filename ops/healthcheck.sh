#!/usr/bin/env bash
# Health check for the Gada Electronics server.
# Prints one line per check. Exit code: 0 = all OK, 1 = at least one check failed.
set -u

URL="${GADA_URL:-http://localhost:3000}"
DISK_LIMIT="${DISK_LIMIT:-80}"    # percent used
MEM_MIN_MB="${MEM_MIN_MB:-100}"   # available memory in MB

failures=0

ok()   { echo "OK    $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }

check_service() {
  if systemctl is-active --quiet "$1"; then
    ok "service $1 is active"
  else
    fail "service $1 is not active"
  fi
}

check_http() {
  local path="$1" code
  code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$URL$path" || true)
  if [ "$code" = "200" ]; then
    ok "GET $path returned 200"
  else
    fail "GET $path returned ${code:-no response}"
  fi
}

check_disk() {
  local used
  used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  if [ "$used" -lt "$DISK_LIMIT" ]; then
    ok "disk / is ${used}% used"
  else
    fail "disk / is ${used}% used (limit ${DISK_LIMIT}%)"
  fi
}

check_memory() {
  local avail
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  if [ "$avail" -ge "$MEM_MIN_MB" ]; then
    ok "memory available ${avail} MB"
  else
    fail "memory available ${avail} MB (minimum ${MEM_MIN_MB} MB)"
  fi
}

check_service mongod
check_service gada
check_http /health
check_http /ready
check_disk
check_memory

if [ "$failures" -eq 0 ]; then
  echo "RESULT: healthy"
  exit 0
fi
echo "RESULT: $failures check(s) failed"
exit 1
