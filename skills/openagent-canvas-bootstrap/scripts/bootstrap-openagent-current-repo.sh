#!/usr/bin/env bash
set -euo pipefail

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  echo "Missing required command: $1" >&2
  exit 1
}

require_command git
require_command node
require_command pnpm

TARGET_REPO="${OPENAGENT_TARGET_REPO:-$PWD}"
if [[ ! -d "$TARGET_REPO" ]]; then
  echo "Target repo does not exist: $TARGET_REPO" >&2
  exit 1
fi
TARGET_REPO="$(cd "$TARGET_REPO" && pwd)"

OPENAGENT_REPO_URL="${OPENAGENT_REPO_URL:-https://github.com/openagentmarket/openagent.git}"
OPENAGENT_INSTALL_DIR="${OPENAGENT_INSTALL_DIR:-$HOME/.openagent/source/openagent}"
OPENAGENT_VAULT_PATH="${OPENAGENT_VAULT_PATH:-}"
OPENAGENT_VAULT_ROOT="${OPENAGENT_VAULT_ROOT:-}"
OPENAGENT_VAULT_NAME="${OPENAGENT_VAULT_NAME:-}"
OPENAGENT_WORKSPACE_NAME="${OPENAGENT_WORKSPACE_NAME:-$(basename "$TARGET_REPO")}"
OPENAGENT_SKIP_CONVOS_START="${OPENAGENT_SKIP_CONVOS_START:-0}"
OPENAGENT_NO_OPEN_DASHBOARD="${OPENAGENT_NO_OPEN_DASHBOARD:-0}"

mkdir -p "$(dirname "$OPENAGENT_INSTALL_DIR")"

if [[ -d "$OPENAGENT_INSTALL_DIR/.git" ]]; then
  echo "Using existing OpenAgent checkout at $OPENAGENT_INSTALL_DIR"
else
  if [[ -e "$OPENAGENT_INSTALL_DIR" ]]; then
    echo "OpenAgent install path exists but is not a git checkout: $OPENAGENT_INSTALL_DIR" >&2
    exit 1
  fi
  echo "Cloning OpenAgent into $OPENAGENT_INSTALL_DIR"
  git clone --depth 1 "$OPENAGENT_REPO_URL" "$OPENAGENT_INSTALL_DIR"
fi

if [[ "${OPENAGENT_UPDATE:-0}" == "1" ]]; then
  echo "Updating OpenAgent checkout"
  git -C "$OPENAGENT_INSTALL_DIR" pull --ff-only
fi

cd "$OPENAGENT_INSTALL_DIR"
echo "Installing OpenAgent dependencies"
pnpm install

bootstrap_args=(
  --repo "$TARGET_REPO"
  --skip-install
  --workspace-name "$OPENAGENT_WORKSPACE_NAME"
)

if [[ -n "$OPENAGENT_VAULT_PATH" ]]; then
  bootstrap_args+=(--vault "$OPENAGENT_VAULT_PATH")
fi

if [[ -n "$OPENAGENT_VAULT_ROOT" ]]; then
  bootstrap_args+=(--vault-root "$OPENAGENT_VAULT_ROOT")
fi

if [[ -n "$OPENAGENT_VAULT_NAME" ]]; then
  bootstrap_args+=(--vault-name "$OPENAGENT_VAULT_NAME")
fi

if [[ "$OPENAGENT_SKIP_CONVOS_START" == "1" ]]; then
  bootstrap_args+=(--skip-convos-start)
fi

if [[ "$OPENAGENT_NO_OPEN_DASHBOARD" == "1" ]]; then
  bootstrap_args+=(--no-open-dashboard)
fi

echo "Bootstrapping Obsidian vault for $TARGET_REPO"
node scripts/openagent-cli.mjs bootstrap-repo "${bootstrap_args[@]}" "$@"
