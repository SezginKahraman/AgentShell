#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ ! -d web/node_modules ]]; then
  echo "Installing dashboard dependencies..."
  (cd web && npm ci)
fi

echo "Building AgentShell..."
(cd web && npm run build)
mkdir -p bin
go build -o bin/agentshell ./cmd/agentshell

exec ./bin/agentshell server "$@"
