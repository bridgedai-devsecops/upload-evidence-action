#!/usr/bin/env bash
set -euo pipefail
bad=0
while IFS= read -r line; do
  ref=$(printf '%s
' "$line" | awk '{for (i=1;i<=NF;i++) if ($i=="uses:") {print $(i+1); exit}}')
  [ -z "$ref" ] && continue
  case "$ref" in
    ./*) continue ;;
  esac
  if ! printf '%s
' "$ref" | grep -q '@'; then echo "Unpinned action: $line" >&2; bad=1; fi
  if printf '%s
' "$ref" | grep -qE '@(main|master|HEAD)$'; then echo "Mutable branch action ref: $line" >&2; bad=1; fi
done < <(grep -R "uses:" .github/workflows 2>/dev/null || true)
exit $bad
