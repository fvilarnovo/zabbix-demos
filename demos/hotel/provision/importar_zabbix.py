#!/usr/bin/env python3
"""Importa en Zabbix 8.0 la configuración exportada de la demo del hotel: templates, hosts y dashboards.

Uso (con un token de Super admin):
  ZABBIX_API_TOKEN=xxxx python3 importar_zabbix.py [https://127.0.0.1/api_jsonrpc.php] [carpeta export]

Orden: templates -> hosts -> dashboards. Es idempotente: crea lo que falta y actualiza lo que ya existe.
Las reglas CEP no entran por la importación: ejecuta después crear_cep_hotel.py.
También se usa como módulo desde provisionar.py (importar_archivos).
"""
import json
import os
import ssl
import sys
import urllib.request

CRIAR_E_ATUALIZAR = {"createMissing": True, "updateExisting": True}
SO_CRIAR = {"createMissing": True}
REGRAS = {
    "template_groups": SO_CRIAR, "host_groups": SO_CRIAR,
    "templates": CRIAR_E_ATUALIZAR, "templateLinkage": SO_CRIAR, "templateDashboards": CRIAR_E_ATUALIZAR,
    "hosts": CRIAR_E_ATUALIZAR, "items": CRIAR_E_ATUALIZAR, "triggers": CRIAR_E_ATUALIZAR,
    "discoveryRules": CRIAR_E_ATUALIZAR, "graphs": CRIAR_E_ATUALIZAR, "httptests": CRIAR_E_ATUALIZAR,
    "valueMaps": CRIAR_E_ATUALIZAR, "dashboards": CRIAR_E_ATUALIZAR,
}
ARQUIVOS = ["templates_hotel.yaml", "hosts_hotel.yaml", "dashboards_hotel.yaml"]
# Los ítems trapper de los hosts usan esta macro global; la exportación de hosts no la incluye.
MACROS_GLOBAIS = {"{$TRAPPER.ALLOWED_HOSTS}": "127.0.0.1,::1"}


def crear_api(url, token, timeout=120):
    """Devuelve api(method, params) que lanza RuntimeError si Zabbix responde con error."""
    ctx = ssl._create_unverified_context() if url.startswith("https") else None

    def api(method, params):
        req = urllib.request.Request(
            url, data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
            headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            resp = json.load(r)
        if "error" in resp:
            e = resp["error"]
            raise RuntimeError(f"{method}: {e.get('message')} {e.get('data')}")
        return resp["result"]
    return api


def importar_archivos(api, pasta, log=print):
    """Importa los tres YAML en orden. Devuelve True si todos fueron bien."""
    todo_ok = True
    for nome in ARQUIVOS:
        with open(os.path.join(pasta, nome), encoding="utf-8") as f:
            fonte = f.read()
        try:
            ok = api("configuration.import", {"format": "yaml", "source": fonte, "rules": REGRAS})
        except RuntimeError as e:
            log(f"!! {nome}: {e}")
            todo_ok = False
            continue
        log(f"{'OK' if ok else '!!'} importado {nome}")
        todo_ok = todo_ok and bool(ok)
    return todo_ok


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://127.0.0.1/api_jsonrpc.php"
    pasta = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "export")
    token = os.environ.get("ZABBIX_API_TOKEN")
    if not token:
        raise SystemExit("Falta ZABBIX_API_TOKEN")
    api = crear_api(url, token)
    existentes = {m["macro"] for m in api("usermacro.get", {"globalmacro": True, "output": ["macro"]})}
    for macro, valor in MACROS_GLOBAIS.items():
        if macro not in existentes:
            api("usermacro.createglobal", {"macro": macro, "value": valor})
            print(f"OK macro global {macro} = {valor}")
    ok = importar_archivos(api, pasta)
    for d in api("dashboard.get", {"output": ["dashboardid", "name"], "search": {"name": "Hotel ·"}}):
        print(f"   dashboard {d['dashboardid']}: {d['name']}  ->  {url.rsplit('/', 1)[0]}/zabbix.php?action=dashboard.view&dashboardid={d['dashboardid']}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
