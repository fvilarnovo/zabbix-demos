#!/usr/bin/env python3
"""Provisiona un Zabbix 8.0 para la demo del Hotel Gran Forum. One-shot e idempotente (puede correr en cada deploy).

Todo se lee de variables de entorno:
  ZABBIX_URL, ZABBIX_API_TOKEN          obligatorias
  CH_URL (http://clickhouse:8123/), CH_USER (zabbix), CH_PASSWORD ("")
  TRAPPER_ALLOWED (10.0.0.0/8,172.16.0.0/12,192.168.0.0/16)
  OTEL_SERVICE_NAMESPACE (hotel)
  PROVISION_MCP_USER (0/1, default 0), MCP_TOKEN_FILE (/salida/zabbix_mcp_demo_token)
  ESPERA_API_SEG (300)
Código de salida 0 solo si todo fue bien. Nunca imprime tokens ni contraseñas.
"""
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.request

import importar_zabbix

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA_EXPORT = os.path.join(AQUI, "export")
RESUMEN = "/salida/resumen.json"

TEMPLATE_KPI = "Hotel KPIs by ClickHouse"
HOST_APM = "apm-discovery-test"
HOSTS_TRAPPER = ["Hotel Gran Forum - FinOps", "AWS Cost", "Google Cloud Cost"]
DASHBOARDS = ["Hotel · Negocio", "Hotel · Operación", "Hotel · Cloud Cost"]
TIPO_TRAPPER = 2
TIPO_MACRO_SECRETO = 1

fallos = []


def ok(paso, msg):
    print(f"[{paso}] OK {msg}", flush=True)


def mal(paso, msg):
    print(f"[{paso}] !! {msg}", flush=True)
    fallos.append(f"{paso}: {msg}")


def env(nombre, defecto=None):
    v = os.environ.get(nombre)
    return v if v not in (None, "") else defecto


def version_api(url):
    """apiinfo.version se llama sin autenticación."""
    req = urllib.request.Request(
        url, data=json.dumps({"jsonrpc": "2.0", "method": "apiinfo.version", "params": [], "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc"})
    ctx = ssl._create_unverified_context() if url.startswith("https") else None
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        resp = json.load(r)
    if "result" not in resp:
        raise RuntimeError(str(resp.get("error")))
    return resp["result"]


def paso1_esperar(url, api, espera):
    fin = time.time() + espera
    version, ultimo = None, ""
    while True:
        try:
            version = version_api(url)
            break
        except Exception as e:  # la API todavía no arranca
            ultimo = str(e)
            if time.time() >= fin:
                raise SystemExit(f"[1] !! La API no respondió en {espera} s ({url}): {ultimo}")
            print(f"[1] .. esperando la API ({ultimo[:80]})", flush=True)
            time.sleep(5)
    if not version.startswith("8."):
        raise SystemExit(f"[1] !! Se requiere Zabbix 8.x y la API reporta {version}")
    try:
        api("host.get", {"output": ["hostid"], "limit": 1})
    except Exception as e:
        raise SystemExit(f"[1] !! Token inválido o sin permisos: {e}")
    ok(1, f"API responde, Zabbix {version}, token válido")
    return version


def paso2_macro_global(api, valor):
    macro = "{$TRAPPER.ALLOWED_HOSTS}"
    m = api("usermacro.get", {"globalmacro": True, "output": ["globalmacroid", "value"], "filter": {"macro": macro}})
    if not m:
        api("usermacro.createglobal", {"macro": macro, "value": valor})
        ok(2, f"macro global {macro} creada = {valor}")
    elif m[0]["value"] != valor:
        api("usermacro.updateglobal", {"globalmacroid": m[0]["globalmacroid"], "value": valor})
        ok(2, f"macro global {macro} actualizada = {valor}")
    else:
        ok(2, f"macro global {macro} ya vale {valor}")


def paso3_importar(api):
    if importar_zabbix.importar_archivos(api, PASTA_EXPORT, log=lambda m: print(f"[3] {m}", flush=True)):
        ok(3, "templates, hosts y dashboards importados")
    else:
        mal(3, "falló la importación de algún archivo")


def fijar_macro(api, hostid, macro, valor, existentes, secreto=False):
    e = existentes.get(macro)
    if e is None:
        p = {"hostid": hostid, "macro": macro, "value": valor}
        if secreto:
            p["type"] = TIPO_MACRO_SECRETO
        api("usermacro.create", p)
        return "creada"
    if secreto or e.get("value") != valor:  # el valor de un secreto no se puede leer: se reescribe siempre
        api("usermacro.update", {"hostmacroid": e["hostmacroid"], "value": valor})
        return "actualizada"
    return "sin cambios"


def paso4_macros_ch(api, ch_url, ch_user, ch_pass, ns):
    objetivos = []
    t = api("template.get", {"output": ["templateid"], "filter": {"host": [TEMPLATE_KPI]}})
    h = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST_APM]}})
    for nombre, r in ((TEMPLATE_KPI, t), (HOST_APM, h)):
        if not r:
            mal(4, f"no existe '{nombre}'")
        else:
            objetivos.append((nombre, r[0].get("templateid") or r[0]["hostid"]))
    for nombre, hid in objetivos:
        ex = {m["macro"]: m for m in api("usermacro.get", {"hostids": [hid], "output": ["hostmacroid", "macro", "value", "type"]})}
        deseadas = [("{$CH.URL}", ch_url, False), ("{$CH.USER}", ch_user, False), ("{$CH.PASSWORD}", ch_pass, True)]
        if nombre == HOST_APM:
            deseadas.append(("{$APM.NAMESPACE.MATCHES}", f"^{ns}$", False))
        for macro, valor, secreto in deseadas:
            try:
                ok(4, f"{nombre}: {macro} {fijar_macro(api, hid, macro, valor, ex, secreto)}")
            except RuntimeError as e:
                mal(4, f"{nombre}: {macro}: {e}")


def paso5_trapper(api, permitidos):
    hosts = api("host.get", {"output": ["hostid", "host"], "filter": {"host": HOSTS_TRAPPER}})
    if not hosts:
        mal(5, "no se encontraron los hosts con ítems trapper")
        return
    items = api("item.get", {"output": ["itemid", "trapper_hosts"], "hostids": [h["hostid"] for h in hosts],
                             "filter": {"type": TIPO_TRAPPER}})
    cambiar = [i for i in items if i["trapper_hosts"].strip() == "127.0.0.1"]
    for i in cambiar:
        api("item.update", {"itemid": i["itemid"], "trapper_hosts": permitidos})
    ok(5, f"ítems trapper revisados: {len(items)}, corregidos de 127.0.0.1: {len(cambiar)}")


def subproceso(paso, script, url, extra_env=None):
    entorno = dict(os.environ, **(extra_env or {}))
    r = subprocess.run([sys.executable, "-u", os.path.join(AQUI, script), url], env=entorno,
                       capture_output=True, text=True, timeout=600)
    for linea in (r.stdout + r.stderr).splitlines():
        print(f"[{paso}]    {linea}", flush=True)
    if r.returncode != 0:
        mal(paso, f"{script} terminó con código {r.returncode}")
        return False
    ok(paso, f"{script} terminó bien")
    return True


def paso8_discovery(api):
    try:
        h = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST_APM]}})
        i = api("item.get", {"output": ["itemid"], "hostids": [h[0]["hostid"]], "filter": {"key_": "apm.applications.get"}})
        api("task.create", [{"type": 6, "request": {"itemid": i[0]["itemid"]}}])
        ok(8, "discovery APM forzado")
    except Exception as e:
        print(f"[8] !! no se pudo forzar el discovery (se ignora): {e}", flush=True)


def paso9_resumen(api, url, version):
    base = url.rsplit("/", 1)[0]
    dash = {d["name"]: d["dashboardid"] for d in api("dashboard.get", {"output": ["dashboardid", "name"], "search": {"name": "Hotel ·"}})}
    dashboards = []
    for n in DASHBOARDS:
        if n in dash:
            dashboards.append({"nombre": n, "dashboardid": dash[n]})
            ok(9, f"dashboard '{n}' id {dash[n]} -> {base}/zabbix.php?action=dashboard.view&dashboardid={dash[n]}")
        else:
            mal(9, f"falta el dashboard '{n}'")
    reglas = []
    try:
        for r in api("ceprule.get", {"output": "extend", "search": {"name": "Hotel:"}}):
            estado = "habilitada" if str(r.get("status")) == "0" else "deshabilitada"
            reglas.append({"nombre": r["name"], "cep_ruleid": r["cep_ruleid"], "estado": estado})
            ok(9, f"regla CEP '{r['name']}': {estado}")
    except RuntimeError as e:
        mal(9, f"ceprule.get: {e}")
    if len(reglas) != 2:
        mal(9, f"se esperaban 2 reglas CEP y hay {len(reglas)}")
    datos = {"zabbix_version": version, "dashboards": dashboards, "reglas_cep": reglas,
             "correcto": not fallos, "fallos": fallos}
    try:
        os.makedirs(os.path.dirname(RESUMEN), exist_ok=True)
        with open(RESUMEN, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)
        ok(9, f"resumen escrito en {RESUMEN}")
    except OSError as e:
        mal(9, f"no se pudo escribir {RESUMEN}: {e}")


def main():
    url, token = env("ZABBIX_URL"), env("ZABBIX_API_TOKEN")
    if not url or not token:
        raise SystemExit("!! Faltan ZABBIX_URL y/o ZABBIX_API_TOKEN")
    ch_url = env("CH_URL", "http://clickhouse:8123/")
    ch_user = env("CH_USER", "zabbix")
    ch_pass = os.environ.get("CH_PASSWORD", "")
    permitidos = env("TRAPPER_ALLOWED", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    ns = env("OTEL_SERVICE_NAMESPACE", "hotel")
    con_mcp = env("PROVISION_MCP_USER", "0") == "1"
    archivo_mcp = env("MCP_TOKEN_FILE", "/salida/zabbix_mcp_demo_token")
    espera = int(env("ESPERA_API_SEG", "300"))

    api = importar_zabbix.crear_api(url, token)
    version = paso1_esperar(url, api, espera)
    pasos = [
        (2, lambda: paso2_macro_global(api, permitidos)),
        (3, lambda: paso3_importar(api)),
        (4, lambda: paso4_macros_ch(api, ch_url, ch_user, ch_pass, ns)),
        (5, lambda: paso5_trapper(api, permitidos)),
        (6, lambda: subproceso(6, "crear_cep_hotel.py", url, {"ZABBIX_API_TOKEN": token})),
    ]
    if con_mcp:
        pasos.append((7, lambda: subproceso(7, "crear_usuario_mcp.py", url,
                                            {"ZABBIX_API_TOKEN": token, "MCP_TOKEN_FILE": archivo_mcp})))
    else:
        print("[7] -- PROVISION_MCP_USER no es 1: se omite el usuario MCP", flush=True)
    pasos.append((8, lambda: paso8_discovery(api)))
    for n, f in pasos:
        try:
            f()
        except Exception as e:
            mal(n, str(e))
    try:
        paso9_resumen(api, url, version)
    except Exception as e:
        mal(9, str(e))
    if fallos:
        print(f"\n!! Provisioning con {len(fallos)} fallo(s)", flush=True)
        sys.exit(1)
    print("\nOK Provisioning completo", flush=True)


if __name__ == "__main__":
    main()
