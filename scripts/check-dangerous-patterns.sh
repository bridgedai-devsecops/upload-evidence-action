#!/usr/bin/env bash
set -euo pipefail
bad=0
if grep -R "child_process\.exec(" src dist tests 2>/dev/null; then echo 'Unsafe child_process.exec found.' >&2; bad=1; fi
if grep -R "eval(" src dist tests 2>/dev/null; then echo 'Unsafe eval found.' >&2; bad=1; fi
if grep -R "set-output" src dist tests .github 2>/dev/null; then echo 'Deprecated set-output found.' >&2; bad=1; fi
exit $bad
