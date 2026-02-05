#!/usr/bin/env bash
# Guardrail: ensure tenant-scoped services never import the global db instance.
# Allowed: importing DbClient type, importing schema, importing context wrappers.
# Banned: `import { db }`, `import { rawDb }` from '../db/index.js' in service files
# (except auth.ts which intentionally operates outside RLS context).

set -euo pipefail

SERVICES_DIR="src/services"
EXCLUDED="auth.ts"

violations=0

for file in "$SERVICES_DIR"/*.ts; do
  basename=$(basename "$file")
  if [ "$basename" = "$EXCLUDED" ]; then
    continue
  fi

  # Look for lines importing from db/index that include `db` or `rawDb` as a value
  # Skip: import type { DbClient } from '../db/index.js'
  if grep -n "from ['\"]\.\.\/db" "$file" | grep -v "import type" | grep -E "\{ (db|rawDb)[,} ]" > /dev/null 2>&1; then
    echo "ERROR: $file imports global db/rawDb instance. Use DbClient type + withTenantContext/withUserContext instead."
    violations=$((violations + 1))
  fi
done

if [ $violations -gt 0 ]; then
  echo ""
  echo "Found $violations file(s) with banned global db imports."
  echo "Services must accept a 'tx: DbClient' parameter and be called within withTenantContext/withUserContext."
  exit 1
fi

echo "RLS import guard: OK — no global db imports found in tenant services."
