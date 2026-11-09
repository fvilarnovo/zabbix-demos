#!/bin/bash
# Controles de la demo del hotel. Corre en el computador del presentador y actúa por HTTP.
#   ./demo.sh check                                 comprobación previa
#   ./demo.sh act1 normal|promo|pagos-lentos|pagos-error
#   ./demo.sh act2 corte|elevador|normal
#   ./demo.sh act3 gcp|aws|normal                   anomalía de costo (normal la quita)
#   ./demo.sh reset                                 todo a la normalidad
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$AQUI/demo.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$AQUI/demo.env"
  set +a
fi

if [ -z "${1:-}" ]; then sed -n '2,7p' "$0"; exit 2; fi
case "$1" in check|act1|act2|act3|reset) ;; *) sed -n '2,7p' "$0"; exit 2 ;; esac

if [ -z "${CONTROL_URL:-}" ] || [ -z "${CONTROL_TOKEN:-}" ]; then
  echo "Faltan CONTROL_URL y/o CONTROL_TOKEN. Defínelas en $AQUI/demo.env (ver demo.env.example) o expórtalas." >&2
  exit 1
fi
CONTROL_URL="${CONTROL_URL%/}"

# Imprime el campo "mensaje" de un JSON recibido por stdin.
mensaje() {
  python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get("mensaje", d))
except Exception:
    print("Respuesta no válida del control.")'
}

# llamar METODO RUTA : imprime el mensaje; si falla HTTP muestra el mensaje de error del servidor.
llamar() {
  local cuerpo codigo
  cuerpo="$(mktemp)"
  codigo="$(curl -sS -m 90 -X "$1" -o "$cuerpo" -w '%{http_code}' \
    -H "Authorization: Bearer $CONTROL_TOKEN" "$CONTROL_URL$2")" || { rm -f "$cuerpo"; echo "No se pudo conectar con $CONTROL_URL" >&2; return 1; }
  mensaje < "$cuerpo"
  rm -f "$cuerpo"
  case "$codigo" in 2*) ;; *) echo "Error HTTP $codigo" >&2; return 1 ;; esac
}

case "$1" in
  check)
    set +e
    salida="$(curl -fsS -m 30 -H "Accept: text/plain" -H "Authorization: Bearer $CONTROL_TOKEN" "$CONTROL_URL/check")"
    rc=$?
    set -e
    if [ $rc -ne 0 ]; then echo "No se pudo consultar $CONTROL_URL/check (curl código $rc)" >&2; exit 1; fi
    printf '%s\n' "$salida"
    case "$salida" in *"Todo listo."*) exit 0 ;; *) exit 1 ;; esac
    ;;
  act1)  llamar POST "/act1/${2:?falta el modo}" ;;
  act2)  llamar POST "/act2/${2:?falta el escenario}" ;;
  act3)  llamar POST "/act3/${2:?falta la nube}" ;;
  reset) llamar POST /reset ;;
esac
