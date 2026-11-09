#!/usr/bin/env bash
# Crea una demo nueva a partir de demos/_plantilla. Uso: ./nueva_demo.sh <nombre>
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
NOMBRE="${1:-}"

if [[ -z "$NOMBRE" ]]; then
  echo "Uso: $0 <nombre>   (minúsculas, dígitos y guiones; empieza por letra)" >&2
  exit 1
fi
if [[ ! "$NOMBRE" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "!! Nombre inválido: '$NOMBRE'. Debe cumplir ^[a-z][a-z0-9-]*\$" >&2
  exit 1
fi
DESTINO="$RAIZ/demos/$NOMBRE"
if [[ -e "$DESTINO" ]]; then
  echo "!! Ya existe $DESTINO" >&2
  exit 1
fi

# sed -i portable: GNU sed acepta -i sin argumento; BSD (macOS) exige -i ''
if sed --version >/dev/null 2>&1; then
  sed_i() { sed -i "$@"; }
else
  sed_i() { sed -i '' "$@"; }
fi

cp -R "$RAIZ/demos/_plantilla" "$DESTINO"
find "$DESTINO" -name '__pycache__' -type d -prune -exec rm -rf {} +

# reemplazar PLANTILLA por el nombre en todos los archivos de texto
while IFS= read -r -d '' f; do
  if grep -Iq . "$f" 2>/dev/null; then
    sed_i "s/PLANTILLA/$NOMBRE/g" "$f"
  fi
done < <(find "$DESTINO" -type f -print0)

# piezas genéricas siempre en su versión actual
cp "$RAIZ/comun/supervisor.py" "$RAIZ/comun/zbx_sender.py" "$RAIZ/comun/zabbix_api.py" "$DESTINO/"
cp "$RAIZ/comun/provisionar.py" "$DESTINO/provision/provisionar.py"

cat <<FIN
OK Demo creada en demos/$NOMBRE

Próximos pasos:
  1. Editar la app (demos/$NOMBRE/app/main.py) y procesos.json; buscar los TODO.
  2. Exportar la configuración de Zabbix a demos/$NOMBRE/provision/export:
       ZABBIX_URL=https://IP/api_jsonrpc.php ZABBIX_API_TOKEN=xxxx python3 comun/exportar_zabbix.py \\
         --demo $NOMBRE --templates "A,B" --hosts "X,Y" --dashboards "D1,D2" \\
         --salida demos/$NOMBRE/provision/export
  3. Completar demos/$NOMBRE/.env.example (y docker-compose.yml si añades variables o puertos).
  4. Leer docs/DESPLIEGUE-DOKPLOY.md para desplegar en Dokploy.
FIN
