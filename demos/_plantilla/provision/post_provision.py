#!/usr/bin/env python3
"""Pasos de provisioning específicos de la demo PLANTILLA (macros, reglas CEP, usuarios...).

Lo ejecuta provisionar.py después de importar los YAML, con el entorno del contenedor
(ZABBIX_URL y ZABBIX_API_TOKEN disponibles). Sale con código distinto de 0 si algo falla.
TODO: añadir los pasos propios de la demo.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # zabbix_api.py está en /srv
from zabbix_api import crear_api  # noqa: E402


def main():
    api = crear_api(os.environ["ZABBIX_URL"], os.environ["ZABBIX_API_TOKEN"])  # noqa: F841
    # Ejemplo: api("usermacro.createglobal", {"macro": "{$MI.MACRO}", "value": "x"})
    print("sin pasos extra")


if __name__ == "__main__":
    main()
