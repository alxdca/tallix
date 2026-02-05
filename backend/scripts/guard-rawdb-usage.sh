#!/usr/bin/env bash
# Guardrail: Restrict rawDb imports to explicitly allowed infrastructure files.
# 
# Background:
# rawDb bypasses the runtime guard and RLS context checks. It should ONLY be used
# in pre-authentication flows (auth service), startup checks, and internal plumbing
# (context implementation). Any other usage risks cross-tenant data leaks.
#
# This script enforces an explicit allowlist of files that can import rawDb.

set -euo pipefail

# Allowlist: Files permitted to import rawDb
# Add new entries carefully and document the reason in docs/rls/RLS_ENFORCEMENT_GUIDE.md
ALLOWED_FILES=(
  "src/db/index.ts"          # Defines rawDb export
  "src/db/context.ts"        # Context implementation needs rawDb for transaction management
  "src/services/auth.ts"     # Pre-auth operations (login, register) lack user context
  "src/index.ts"             # Startup checks (DB role verification) before app starts
  "tests/rls-enforcement.test.ts"  # Test infrastructure needs rawDb for setup/teardown
)

echo "🔍 Checking rawDb imports across backend..."
echo ""

violations=()

# Find all TypeScript files that import rawDb
# Pattern matches: import { rawDb } or import { rawDb as ... }
# Using grep with find for portability (rg not always available)
while IFS= read -r file; do
  # Skip if file doesn't exist or isn't readable
  [ -f "$file" ] || continue
  
  # Check if file imports rawDb (not just in comments)
  # Match: import { rawDb } or import { rawDb as ...
  if grep -E "import\s+\{[^}]*rawDb" "$file" > /dev/null 2>&1; then
    # Normalize path (remove leading ./ if present)
    normalized_file="${file#./}"
    
    # Check if file is in allowlist
    allowed=false
    for allowed_file in "${ALLOWED_FILES[@]}"; do
      # Match both with and without backend/ prefix
      if [[ "$normalized_file" == "$allowed_file" ]] || \
         [[ "$normalized_file" == "backend/$allowed_file" ]] || \
         [[ "$normalized_file" == "./$allowed_file" ]]; then
        allowed=true
        break
      fi
    done
    
    if [ "$allowed" = false ]; then
      violations+=("$normalized_file")
    fi
  fi
done < <(find src tests -name "*.ts" 2>/dev/null || true)

# Report results
if [ ${#violations[@]} -gt 0 ]; then
  echo "❌ ERROR: Found ${#violations[@]} unauthorized rawDb import(s):"
  echo ""
  for violation in "${violations[@]}"; do
    echo "  ⚠️  $violation"
  done
  echo ""
  echo "rawDb bypasses RLS context and should only be used in infrastructure code."
  echo ""
  echo "Allowed files (see docs/rls/RLS_ENFORCEMENT_GUIDE.md):"
  for allowed_file in "${ALLOWED_FILES[@]}"; do
    echo "  ✅ $allowed_file"
  done
  echo ""
  echo "If you need to add a new file to the allowlist:"
  echo "  1. Ensure the operation genuinely lacks user/tenant context"
  echo "  2. Add the file path to scripts/guard-rawdb-usage.sh"
  echo "  3. Document the reason in docs/rls/RLS_ENFORCEMENT_GUIDE.md"
  echo "  4. Get approval in code review"
  echo ""
  exit 1
fi

echo "✅ rawDb guard: PASS"
echo "   All rawDb imports are from allowed infrastructure files."
echo ""
