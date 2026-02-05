#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v git >/dev/null 2>&1; then
  REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)
fi
if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
fi

ENV_FILE=${ENV_FILE:-}
if [ -z "$ENV_FILE" ]; then
  if [ -f "$REPO_ROOT/.env" ]; then
    ENV_FILE="$REPO_ROOT/.env"
  elif [ -f "$REPO_ROOT/backend/.env" ]; then
    ENV_FILE="$REPO_ROOT/backend/.env"
  fi
fi

if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "Missing .env (set ENV_FILE or add .env at repo root or backend/.env)" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

DB_CONTAINER=${DB_CONTAINER:-tallix-db}
DB_NAME_RESOLVED=${POSTGRES_DB:-${DB_NAME:-tallix}}

if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_USER and POSTGRES_PASSWORD must be set in .env" >&2
  exit 1
fi

if [ ! -f "$REPO_ROOT/backend/drizzle/meta/_journal.json" ]; then
  echo "Missing backend/drizzle/meta/_journal.json" >&2
  exit 1
fi

if [ ! -d "$REPO_ROOT/backend/drizzle" ]; then
  echo "Missing backend/drizzle directory" >&2
  exit 1
fi

docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$DB_NAME_RESOLVED" \
  -c "CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint not null);"

jq -r '.entries[] | "\(.tag) \(.when)"' "$REPO_ROOT/backend/drizzle/meta/_journal.json" | \
while read -r tag when; do
  num=${tag%%_*}
  if [ "$num" -ge 20 ]; then
    continue
  fi
  file="$REPO_ROOT/backend/drizzle/${tag}.sql"
  if [ ! -f "$file" ]; then
    echo "Missing migration file: $file" >&2
    exit 1
  fi
  hash=$(shasum -a 256 "$file" | awk '{print $1}')
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$DB_NAME_RESOLVED" \
    -c "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '$hash', $when WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash='$hash');"
done
