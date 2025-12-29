#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/.bin"

mkdir -p "$BIN_DIR"
export PATH="$BIN_DIR:$PATH"

log() {
  printf '[setup] %s\n' "$*"
}

log "Syncing Python dev tools with uv (lizard lives in .venv/bin)"
uv sync --frozen

if ! command -v scc >/dev/null 2>&1; then
  SCC_VERSION="${SCC_VERSION:-v3.6.0}"
  SCC_ARCH="${SCC_ARCH:-Linux_x86_64}"
  SCC_URL="https://github.com/boyter/scc/releases/download/${SCC_VERSION}/scc_${SCC_ARCH}.tar.gz"
  TEMP_DIR="$(mktemp -d)"

  log "Installing scc ${SCC_VERSION} for ${SCC_ARCH}"
  curl -sSL "$SCC_URL" -o "$TEMP_DIR/scc.tar.gz"
  tar -xzf "$TEMP_DIR/scc.tar.gz" -C "$TEMP_DIR"
  install -m 0755 "$TEMP_DIR/scc" "$BIN_DIR/scc"
  rm -rf "$TEMP_DIR"
else
  log "scc already available at $(command -v scc)"
fi

log "Installing Node dependencies with Yarn"
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi
YARN_ENABLE_IMMUTABLE_INSTALLS=1 yarn install --frozen-lockfile

log "Installing Playwright browsers (required for yarn test:e2e)"
npx playwright install --with-deps

log "Setup complete. Add $BIN_DIR and $ROOT_DIR/.venv/bin to PATH for scc and lizard."
