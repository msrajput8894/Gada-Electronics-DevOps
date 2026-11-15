#!/usr/bin/env bash
# Prints Major.Minor.YYMMW.NNNNN, e.g. 1.0.26111.00001
# Major.Minor comes from the VERSION file, W is the week-of-month block
# (days 1-7 = 1, 8-14 = 2, ...), NNNNN is the CI run number.
set -euo pipefail

version_file="${VERSION_FILE:-VERSION}"
base="$(tr -d '[:space:]' < "$version_file")"
if [[ ! "$base" =~ ^[0-9]+\.[0-9]+$ ]]; then
  echo "VERSION must look like 1.0 (got '$base')" >&2
  exit 1
fi

when="${VERSION_DATE:-now}"
year_month="$(date -u -d "$when" +%y%m)"
day="$(date -u -d "$when" +%-d)"
week=$(( (day - 1) / 7 + 1 ))
run="${RUN_NUMBER:-1}"

printf '%s.%s%s.%05d\n' "$base" "$year_month" "$week" "$run"
