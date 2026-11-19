#!/usr/bin/env python3
"""Provisioning genérico de Zabbix 8.0 para una demo. One-shot e idempotente (puede correr en cada deploy).

Pasos:
  1. Espera la API y comprueba el token.
  2. Macro global {$TRAPPER.ALLOWED_HOSTS} = TRAPPER_ALLOWED (crear/actualizar).
  3. Importa con configuration.import los .yaml de provision/export/: primero los que tienen "template" en el
     nombre, luego "host", luego "dashboard", luego el resto por orden alfabético.
  4. Si existe provision/post_provision.py lo ejecuta (macros, reglas CEP, usuarios propios de la demo).
  5. Escribe /salida/resumen.json.

Variables de entorno:
  ZABBIX_URL, ZABBIX_API_TOKEN   obligatorias
  TRAPPER_ALLOWED                (10.0.0.0/8,172.16.0.0/12,192.168.0.0/16)
  DASHBOARDS_PREFIJO             (vacío: no lista dashboards en el resumen)
  ESPERA_API_SEG                 (300)
Código de salida 0 solo si todo fue bien. Nunca imprime tokens.
"""
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.dirname(AQUI))  # zabbix_api.py vive junto al supervisor, un nivel arriba
import zabbix_api  # noqa: E402

PASTA_EXPORT = os.path.join(AQUI, "export")
POST = os.path.join(AQUI, "post_provision.py")
RESUMEN = "/salida/resumen.json"

CRIAR_E_ATUALIZAR = {"createMissing": True, "updateExisting": True}
SO_CRIAR = {"createMissing": True}
REGLAS = {
    "template_groups": SO_CRIAR, "host_groups": SO_CRIAR,
    "templates": CRIAR_E_ATUALIZAR, "templateLinkage": SO_CRIAR, "templateDashboards": CRIAR_E_ATUALIZAR,
    "hosts": CRIAR_E_ATUALIZAR, "items": CRIAR_E_ATUALIZAR, "triggers": CRIAR_E_ATUALIZAR,
    "discoveryRules": CRIAR_E_ATUALIZAR, "graphs": CRIAR_E_ATUALIZAR, "httptests": CRIAR_E_ATUALIZAR,
    "valueMaps": CRIAR_E_ATUALIZAR, "dashboards": CRIAR_E_ATUALIZAR,
}

fallos = []


def ok(paso, msg):
    print(f"[{paso}] OK {msg}", flush=True)


def mal(paso, msg):
    print(f"[{paso}] !! {msg}", flush=True)
    fallos.append(f"{paso}: {msg}")


def env(nombre, defecto=None):
    v = os.environ.get(nombre)
    return v if v not in (None, "") else defecto


def orden_archivos(nombres):
    """template -> host -> dashboard -> resto alfabético."""
    def grupo(n):
        n = n.lower()
        for i, clave in enumerate(("template", "host", "dashboard")):
            if clave in n:
                return i
        return 3
    return sorted(nombres, key=lambda n: (grupo(n), n))


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


def paso3_importar(api, importados):
    if not os.path.isdir(PASTA_EXPORT):
        ok(3, f"no existe {PASTA_EXPORT}: nada que importar")
        return
    archivos = orden_archivos([n for n in os.listdir(PASTA_EXPORT) if n.lower().endswith(".yaml")])
    if not archivos:
        ok(3, "no hay archivos .yaml en export/: nada que importar")
        return
    for nombre in archivos:
        with open(os.path.join(PASTA_EXPORT, nombre), encoding="utf-8") as f:
            fuente = f.read()
        try:
            correcto = api("configuration.import", {"format": "yaml", "source": fuente, "rules": REGLAS})
        except RuntimeError as e:
            mal(3, f"{nombre}: {e}")
            continue
        if correcto:
            importados.append(nombre)
            ok(3, f"importado {nombre}")
        else:
            mal(3, f"{nombre}: la importación devolvió falso")


def paso4_post():
    if not os.path.exists(POST):
        print("[4] -- no hay post_provision.py: se omite", flush=True)
        return
    r = subprocess.run([sys.executable, "-u", POST], env=dict(os.environ), cwd=AQUI,
                       capture_output=True, text=True, timeout=600)
    for linea in (r.stdout + r.stderr).splitlines():
        print(f"[4]    {linea}", flush=True)
    if r.returncode != 0:
        mal(4, f"post_provision.py terminó con código {r.returncode}")
    else:
        ok(4, "post_provision.py terminó bien")


def paso5_resumen(api, url, version, importados, prefijo):
    base = url.rsplit("/", 1)[0]
    dashboards = []
    if prefijo:
        for d in api("dashboard.get", {"output": ["dashboardid", "name"], "search": {"name": prefijo}}):
            dashboards.append({"nombre": d["name"], "dashboardid": d["dashboardid"]})
            ok(5, f"dashboard '{d['name']}' id {d['dashboardid']} -> {base}/zabbix.php?action=dashboard.view&dashboardid={d['dashboardid']}")
    datos = {"zabbix_version": version, "archivos_importados": importados, "dashboards": dashboards,
             "correcto": not fallos, "fallos": fallos}
    try:
        os.makedirs(os.path.dirname(RESUMEN), exist_ok=True)
        with open(RESUMEN, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=2)
        ok(5, f"resumen escrito en {RESUMEN}")
    except OSError as e:
        mal(5, f"no se pudo escribir {RESUMEN}: {e}")


def main():
    url, token = env("ZABBIX_URL"), env("ZABBIX_API_TOKEN")
    if not url or not token:
        raise SystemExit("!! Faltan ZABBIX_URL y/o ZABBIX_API_TOKEN")
    permitidos = env("TRAPPER_ALLOWED", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    prefijo = env("DASHBOARDS_PREFIJO", "")
    espera = int(env("ESPERA_API_SEG", "300"))

    api = zabbix_api.crear_api(url, token)
    try:
        version = zabbix_api.esperar_api(url, espera)
        api("host.get", {"output": ["hostid"], "limit": 1})
    except Exception as e:
        raise SystemExit(f"[1] !! {e}")
    ok(1, f"API responde, Zabbix {version}, token válido")

    importados = []
    pasos = [(2, lambda: paso2_macro_global(api, permitidos)),
             (3, lambda: paso3_importar(api, importados)),
             (4, paso4_post)]
    for n, f in pasos:
        try:
            f()
        except Exception as e:
            mal(n, str(e))
    try:
        paso5_resumen(api, url, version, importados, prefijo)
    except Exception as e:
        mal(5, str(e))
    if fallos:
        print(f"\n!! Provisioning con {len(fallos)} fallo(s)", flush=True)
        sys.exit(1)
    print("\nOK Provisioning completo", flush=True)


if __name__ == "__main__":
    main()
