#!/bin/sh
# h2r.agent — fully-autonomous AIProve agent.
# Requires: AGENT_PRIVATE_KEY env var (EVM keypair, never committed).
#   ./run.sh            full live loop (auth -> list -> enter -> submit -> verify)
#   ./run.sh --dry-run  verify the loop without entering/submitting anything
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi
exec node agent.mjs "$@"
