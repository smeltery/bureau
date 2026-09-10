#!/usr/bin/env bash
set -eu
umask 077
export HOME=/var/data/home
export BUREAU_HOME=/var/data/home/.bureau
export BUREAU_APP_SUPERVISOR=container
export PORT="${PORT:-10000}"
if [[ "$(id -u)" == 0 ]]; then
  # The mounted disk replaces the image's /var/data permissions. Create only
  # our owned subdirectories, then drop root before any app or agent starts.
  install -d -m 700 -o node -g node "$HOME" /var/data/workspaces
  cd /opt/bureau
  exec runuser -u node --preserve-environment -- bash deploy/render/entrypoint.sh
fi
mkdir -p "$HOME" "$BUREAU_HOME/container-runtime" /var/data/workspaces
cd /opt/bureau
exec python3 deploy/render/supervisor.py serve "$BUREAU_HOME/container-runtime" bun deploy/render/office.ts
