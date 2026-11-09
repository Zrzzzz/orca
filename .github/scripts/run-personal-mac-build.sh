#!/usr/bin/env bash
set -euo pipefail

stage="$1"
shift
log="$RUNNER_TEMP/orca-build-$stage.log"
if "$@" 2>&1 | tee "$log"; then
  exit 0
fi
while IFS= read -r line; do
  printf '::error::%s\n' "${line//%/%25}"
done < <(tail -n 20 "$log")
exit 1
