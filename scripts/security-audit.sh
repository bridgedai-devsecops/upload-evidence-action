#!/usr/bin/env bash
set -euo pipefail
bash scripts/check-no-secrets.sh
bash scripts/check-workflow-permissions.sh
bash scripts/check-pinned-actions.sh
bash scripts/check-dangerous-patterns.sh
find . -path './.git' -prune -o -perm -0002 -type f -print | tee /tmp/world_writable.txt
if [ -s /tmp/world_writable.txt ]; then echo 'World-writable files found.' >&2; exit 1; fi
if find .bridgedai -type f 2>/dev/null | grep -q .; then echo 'Runtime .bridgedai evidence should not be committed.' >&2; exit 1; fi
echo 'Security audit passed.'
