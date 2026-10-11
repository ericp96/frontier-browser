#!/usr/bin/env bash
# Configure and build. Expect several hours on a 16+ core machine.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/depot_tools:$PATH"
cd "$ROOT/src-root/src"
mkdir -p out/Frontier
cp "$ROOT/args.gn" out/Frontier/args.gn
gn gen out/Frontier
autoninja -C out/Frontier chrome
