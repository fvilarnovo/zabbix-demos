#!/usr/bin/env python3
"""Exporta a YAML templates, hosts y dashboards de un Zabbix 8.0 para usarlos como provision/export/ de una demo.

Uso:
  ZABBIX_URL=https://IP/api_jsonrpc.php ZABBIX_API_TOKEN=xxxx python3 exportar_zabbix.py \\
      --demo hotel --templates "A,B" --hosts "X,Y" --dashboards "D1,D2" --salida demos/hotel/provision/export

Escribe templates_<demo>.yaml, hosts_<demo>.yaml y dashboards_<demo>.yaml (solo los que se pidan).
Los nombres también se pueden dar por variables: EXPORT_TEMPLATES, EXPORT_HOSTS, EXPORT_DASHBOARDS.
Los hosts descubiertos (p. ej. apm-<namespace>-<entorno>) no se exportan: los recrea el discovery.
Sale con código 1 si algún nombre pedido no existe en Zabbix.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import zabbix_api  # noqa: E402


def lista(texto):
    return [x.strip() for x in (texto or "").split(",") if x.strip()]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demo", required=True, help="nombre de la demo (sufijo de los archivos)")
    ap.add_argument("--templates", default=os.environ.get("EXPORT_TEMPLATES", ""), help="nombres separados por coma")
    ap.add_argument("--hosts", default=os.environ.get("EXPORT_HOSTS", ""), help="nombres separados por coma")
    ap.add_argument("--dashboards", default=os.environ.get("EXPORT_DASHBOARDS", ""), help="nombres separados por coma")
    ap.add_argument("--salida", default="export", help="carpeta de salida (por defecto ./export)")
    args = ap.parse_args()

    url, token = os.environ.get("ZABBIX_URL"), os.environ.get("ZABBIX_API_TOKEN")
    if not url or not token:
        raise SystemExit("!! Faltan ZABBIX_URL y/o ZABBIX_API_TOKEN")
    pedidos = {"templates": lista(args.templates), "hosts": lista(args.hosts), "dashboards": lista(args.dashboards)}
    if not any(pedidos.values()):
        raise SystemExit("!! Indica al menos --templates, --hosts o --dashboards")

    api = zabbix_api.crear_api(url, token, timeout=60)
    os.makedirs(args.salida, exist_ok=True)
    faltan = []

    def exportar(clave, ids, archivo):
        yaml = api("configuration.export", {"format": "yaml", "options": {clave: ids}})
        with open(os.path.join(args.salida, archivo), "w", encoding="utf-8") as f:
            f.write(yaml)
        print(f"OK {archivo}: {len(ids)} {clave}")

    if pedidos["templates"]:
        t = api("template.get", {"output": ["templateid", "host"], "filter": {"host": pedidos["templates"]}})
        faltan += set(pedidos["templates"]) - {x["host"] for x in t}
        if t:
            exportar("templates", [x["templateid"] for x in t], f"templates_{args.demo}.yaml")
    if pedidos["hosts"]:
        h = api("host.get", {"output": ["hostid", "host"], "filter": {"host": pedidos["hosts"]}})
        faltan += set(pedidos["hosts"]) - {x["host"] for x in h}
        if h:
            exportar("hosts", [x["hostid"] for x in h], f"hosts_{args.demo}.yaml")
    if pedidos["dashboards"]:
        d = api("dashboard.get", {"output": ["dashboardid", "name"], "filter": {"name": pedidos["dashboards"]}})
        faltan += set(pedidos["dashboards"]) - {x["name"] for x in d}
        if d:
            exportar("dashboards", [x["dashboardid"] for x in d], f"dashboards_{args.demo}.yaml")
    if faltan:
        print("!! No encontrados:", ", ".join(sorted(faltan)))
        sys.exit(1)


if __name__ == "__main__":
    main()
