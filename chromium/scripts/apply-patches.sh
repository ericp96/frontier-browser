#!/usr/bin/env bash
# Apply patches/series to the fetched tree. Fails loudly on any conflict.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src-root/src"
cd "$SRC"
grep -v '^\s*#' "$ROOT/patches/series" | sed '/^\s*$/d' | awk '{print $1}' | while read -r p; do
  echo "Applying $p"
  git apply --3way "$ROOT/patches/$p"
done
