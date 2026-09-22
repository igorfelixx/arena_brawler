#!/usr/bin/env bash
# Sobe o servidor de desenvolvimento (sem cache).
#
# Abrir o index.html direto (file://) NÃO funciona: módulos ES e carregamento
# de GLB/FBX são bloqueados por CORS. Precisa de servidor HTTP.
cd "$(dirname "$0")"
exec python3 serve.py "${1:-8123}"
