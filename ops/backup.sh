#!/usr/bin/env bash
# Backs up the Gada MongoDB database to a compressed archive and deletes old backups.
set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://127.0.0.1:27017/gada_electronics}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/gada}"
KEEP_DAYS="${KEEP_DAYS:-7}"

umask 077
mkdir -p "$BACKUP_DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
final="$BACKUP_DIR/gada-$stamp.archive.gz"
partial="$final.partial"

# Write to a temporary name first, so a half-written file is never mistaken for a good backup.
if ! mongodump --quiet --uri="$MONGO_URI" --archive="$partial" --gzip; then
  rm -f "$partial"
  echo "$(date -u +%FT%TZ) backup FAILED" >&2
  exit 1
fi

mv "$partial" "$final"
echo "$(date -u +%FT%TZ) backup OK: $final ($(du -h "$final" | cut -f1))"

# Delete backups older than KEEP_DAYS days.
find "$BACKUP_DIR" -name 'gada-*.archive.gz' -mtime +"$KEEP_DAYS" -print -delete
