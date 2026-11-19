#!/bin/bash
# Controles de la demo de la autopista desde el equipo del presentador.
#   ./demo.sh check
#   ./demo.sh escenario fibra-uf2|energia-vegachi|bd-recaudo|operador-tag|gateway-memoria|accidente-uf3|lluvia-dolores|barrera-pbe|galibo|festivo
#   ./demo.sh apagar <escenario>
#   ./demo.sh velocidad 0.5|1|2|4|8
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
  apagar) curl -fsS -X POST -H "$AUTH" "$URL/escenario/${2:?falta el escenario}/apagar" ;;
  *) sed -n '2,7p' "$0"; exit 2 ;;
esac
echo
