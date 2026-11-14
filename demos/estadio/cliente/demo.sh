#!/bin/bash
# Controles de la demo de la estadio desde el equipo del presentador.
#   ./demo.sh check
#   ./demo.sh escenario apagon|molinetes|tablero
#   ./demo.sh velocidad 0.5|1|2|4
#   ./demo.sh reset
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$AQUI/demo.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$AQUI/demo.env"
  set +a
fi
if [ -z "${CONTROL_URL:-}" ] || [ -z "${CONTROL_TOKEN:-}" ]; then
  echo "Faltan CONTROL_URL y/o CONTROL_TOKEN. Defínelas en $AQUI/demo.env." >&2
  exit 1
fi
URL="${CONTROL_URL%/}"
AUTH="Authorization: Bearer $CONTROL_TOKEN"

case "${1:-}" in
  check) curl -fsS -H "$AUTH" "$URL/check" ;;
  reset) curl -fsS -X POST -H "$AUTH" "$URL/reset" ;;
  escenario|velocidad) curl -fsS -X POST -H "$AUTH" "$URL/$1/${2:?falta el valor}" ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
echo
