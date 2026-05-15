#!/usr/bin/env bash
set -euo pipefail
patterns='(ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----|sk_live_[A-Za-z0-9]+)'
if grep -RIE "$patterns" --exclude-dir=.git --exclude='*.zip' .; then
  echo 'Potential hardcoded secret found.' >&2
  exit 1
fi
echo 'No obvious hardcoded secrets found.'
