#!/usr/bin/env bash
# Sobe um servidor local. Abrir o index.html direto (file://) NÃO funciona:
# módulos ES e carregamento de GLB/FBX são bloqueados por CORS.
cd "$(dirname "$0")"
PORT="${1:-8123}"
echo "→ http://localhost:$PORT"
python3 -m http.server "$PORT"
