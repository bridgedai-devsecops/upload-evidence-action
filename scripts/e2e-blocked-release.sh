#!/usr/bin/env bash
set -euo pipefail
if [ -f tests/e2e/blocked.test.mjs ]; then node --test tests/e2e/blocked.test.mjs; else echo 'No blocked e2e test for this action.'; fi
