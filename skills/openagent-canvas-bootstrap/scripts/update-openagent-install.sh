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

OPENAGENT_REPO_URL="${OPENAGENT_REPO_URL:-https://github.com/openagentmarket/openagent.git}"
OPENAGENT_INSTALL_DIR="${OPENAGENT_INSTALL_DIR:-$HOME/.openagent/source/openagent}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
TARGET_SKILL_DIR="$CODEX_HOME_DIR/skills/openagent-canvas-bootstrap"
SOURCE_SKILL_DIR="$OPENAGENT_INSTALL_DIR/skills/openagent-canvas-bootstrap"

mkdir -p "$(dirname "$OPENAGENT_INSTALL_DIR")"

if [[ -d "$OPENAGENT_INSTALL_DIR/.git" ]]; then
  echo "Updating OpenAgent checkout at $OPENAGENT_INSTALL_DIR"
  git -C "$OPENAGENT_INSTALL_DIR" pull --ff-only
else
  if [[ -e "$OPENAGENT_INSTALL_DIR" ]]; then
    echo "OpenAgent install path exists but is not a git checkout: $OPENAGENT_INSTALL_DIR" >&2
    exit 1
  fi
  echo "Cloning OpenAgent into $OPENAGENT_INSTALL_DIR"
  git clone --depth 1 "$OPENAGENT_REPO_URL" "$OPENAGENT_INSTALL_DIR"
fi

cd "$OPENAGENT_INSTALL_DIR"
echo "Installing OpenAgent dependencies"
pnpm install

if [[ ! -f "$SOURCE_SKILL_DIR/SKILL.md" ]]; then
  echo "OpenAgent skill source not found: $SOURCE_SKILL_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_SKILL_DIR/scripts"
cp "$SOURCE_SKILL_DIR/SKILL.md" "$TARGET_SKILL_DIR/SKILL.md"
cp "$SOURCE_SKILL_DIR/scripts/"*.sh "$TARGET_SKILL_DIR/scripts/"
chmod +x "$TARGET_SKILL_DIR/scripts/"*.sh

echo "Synced skill files into $TARGET_SKILL_DIR"
echo "Restart Codex to pick up updated skill instructions."
