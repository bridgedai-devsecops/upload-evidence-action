#!/usr/bin/env bash
set -euo pipefail
if find .github/workflows -name '*.yml' -o -name '*.yaml' | grep -q .; then
  missing=0
  while IFS= read -r wf; do
    if ! grep -q '^permissions:' "$wf"; then echo "Missing top-level permissions in $wf" >&2; missing=1; fi
    if grep -qE 'write-all|read-all' "$wf"; then echo "Broad permissions in $wf" >&2; missing=1; fi
  done < <(find .github/workflows -name '*.yml' -o -name '*.yaml')
  exit $missing
fi
echo 'No workflows found.'
