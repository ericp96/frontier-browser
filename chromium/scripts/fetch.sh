#!/usr/bin/env bash
# Fetch the pinned Chromium source with depot_tools. Needs ~100 GB free disk.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(cat CHROMIUM_VERSION)"
if [ ! -d depot_tools ]; then
  git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git depot_tools
fi
export PATH="$PWD/depot_tools:$PATH"
mkdir -p src-root && cd src-root
if [ ! -f .gclient ]; then
  fetch --nohooks --no-history chromium
fi
cd src
git fetch --depth 1 origin "refs/tags/${VERSION}:refs/tags/${VERSION}"
git checkout -f "tags/${VERSION}"
gclient sync -D --no-history --with_branch_heads --with_tags
gclient runhooks
echo "Chromium ${VERSION} ready in chromium/src-root/src"
