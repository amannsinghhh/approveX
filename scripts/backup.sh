#!/usr/bin/env sh
# Nightly Postgres backup for the production compose stack (Phase 7).
# Cron (as the deploy user):  15 2 * * *  /opt/approvex/scripts/backup.sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/approvex}"
KEEP="${KEEP:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U approvex --format=custom approvex \
  | gzip > "$BACKUP_DIR/approvex-$STAMP.dump.gz"

# Rotate: keep the newest $KEEP dumps.
ls -1t "$BACKUP_DIR"/approvex-*.dump.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "backup written: $BACKUP_DIR/approvex-$STAMP.dump.gz"
# Restore:
#   gunzip -c approvex-<stamp>.dump.gz | docker compose -f docker-compose.prod.yml \
#     exec -T postgres pg_restore -U approvex -d approvex --clean --if-exists
