#!/usr/bin/env bash
# Run all test files in the tests directory

set -euo pipefail

echo "🧪 Running tests..."
echo ""

# Find all test files and run them
test_files=$(find tests -name "*.test.ts" 2>/dev/null || true)

if [ -z "$test_files" ]; then
  echo "⚠️  No test files found in tests/"
  exit 0
fi

failed=0
passed=0

for test_file in $test_files; do
  echo "Running: $test_file"
  if tsx "$test_file"; then
    echo "✅ Passed: $test_file"
    passed=$((passed + 1))
  else
    echo "❌ Failed: $test_file"
    failed=$((failed + 1))
  fi
  echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Results:"
echo "  ✅ Passed: $passed"
echo "  ❌ Failed: $failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $failed -gt 0 ]; then
  exit 1
fi

echo ""
echo "✅ All tests passed!"
