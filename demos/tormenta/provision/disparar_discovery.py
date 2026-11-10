#!/usr/bin/env python3
"""Acelera el discovery APM: el host apm-<ns>-<env> solo puede existir cuando ya hay trazas, después del provisioning.

Nada de la demo depende de ese host para arrancar (dashboards y KPIs viven en hosts fijos). Este proceso solo ejecuta el
discovery cada 30 s hasta que el host aparece, en lugar de esperar los 5 minutos del intervalo normal. El supervisor
relanza los procesos que terminan, así que cuando acaba su trabajo se queda dormido.
"""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from zabbix_api import crear_api  # noqa: E402

HOST_DISCOVERY = "Tormenta - APM discovery"
CLAVE = "apm.applications.get"
INTERVALO = 30


def main():
    url, token = os.environ.get("ZABBIX_URL"), os.environ.get("ZABBIX_API_TOKEN")
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "tormenta")
    ambiente = os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "production")
    objetivo = f"apm-{ns}-{ambiente}"
    if not url or not token or os.environ.get("PROVISION", "1") != "1":
        print("sin API de Zabbix o PROVISION≠1: nada que hacer", flush=True)
        while True:
            time.sleep(3600)
    api = crear_api(url, token)
    while True:
        try:
            if api("host.get", {"output": ["hostid"], "filter": {"host": [objetivo]}}):
                print(f"OK {objetivo} existe", flush=True)
                while True:
                    time.sleep(3600)
            host = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST_DISCOVERY]}})
            item = api("item.get", {"output": ["itemid"], "hostids": [host[0]["hostid"]], "filter": {"key_": CLAVE}})
            api("task.create", [{"type": 6, "request": {"itemid": item[0]["itemid"]}}])
            print(f"discovery forzado, esperando {objetivo}", flush=True)
        except (RuntimeError, OSError, IndexError) as e:
            print(f"!! {type(e).__name__}: {e}", flush=True)
        time.sleep(INTERVALO)


if __name__ == "__main__":
    main()
