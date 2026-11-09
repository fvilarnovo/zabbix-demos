#!/usr/bin/env python3
"""Activa o quita una anomalía de costo de la demo.

Uso (dentro del contenedor):
  python3 anomalia.py activar gcp    # un análisis de BigQuery sin límite
  python3 anomalia.py quitar gcp
  python3 anomalia.py activar aws    # levantamos DR en EC2
  python3 anomalia.py quitar aws
"""
import os
import sys

DIR_ANOMALIAS = os.environ.get("DIR_ANOMALIAS", os.path.join(os.environ.get("ESTADO_DIR", "/estado"), "finops"))
HISTORIAS = {"gcp": "un análisis de BigQuery sin límite", "aws": "levantamos DR en EC2"}


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("activar", "quitar") or sys.argv[2] not in HISTORIAS:
        raise SystemExit(__doc__)
    accion, nube = sys.argv[1:]
    os.makedirs(DIR_ANOMALIAS, exist_ok=True)
    marca = os.path.join(DIR_ANOMALIAS, f"anomalia_{nube}")
    if accion == "activar":
        open(marca, "w").close()
        print(f"OK anomalía de {nube} activa: {HISTORIAS[nube]}")
    else:
        if os.path.exists(marca):
            os.remove(marca)
        print(f"OK anomalía de {nube} quitada")


if __name__ == "__main__":
    main()
