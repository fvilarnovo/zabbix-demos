"""Backend de la escena 3D, la app de control de peajes y el centro de mando.

Sirve las páginas, une el estado de la simulación con los datos reales de Zabbix (problemas con los tags del CEP, ítems
y su historial) y reenvía las acciones al servicio de control (el token nunca llega al navegador).
"""
import collections
import json
import os
import pathlib
import ssl
import sys
import threading
import time
import urllib.request

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import estado_demo as estado  # noqa: E402

AQUI = pathlib.Path(__file__).resolve().parent
CONTROL = os.environ.get("CONTROL_URL_INTERNA", "http://127.0.0.1:8091")
CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
ZABBIX_WEB_URL = os.environ.get("ZABBIX_WEB_URL", "").rstrip("/")
CONTROLES = os.environ.get("AUTOPISTA_CONTROLES", "1") == "1"
ENSAYO = os.environ.get("AUTOPISTA_ENSAYO", "0") == "1"
SONDEO_SEG = 5
HISTORIAL_SEG = 15
TAGS_HUD = ("zona", "rol", "incidente", "causa_raiz", "responsable", "problema", "nivel", "recurso", "recaudo")

# Ítems que muestran el HUD, la app de peajes y el centro de mando: {host: [claves]}
ITEMS = {
    "Autopista - Recaudo": [
        "arm.kpi[recaudo_hoy]", "arm.kpi[transacciones_hoy]", "arm.kpi[tag_pct_hoy]", "arm.kpi[recaudo_1h]",
        "arm.kpi[transacciones_15m]", "arm.kpi[fallidas_15m]", "arm.kpi[tag_rechazados_15m]",
        *[f"arm.apm.{s}.{m}" for s in ("gateway", "validacion", "transacciones", "operador") for m in ("p95", "error_pct", "total")],
    ],
    "Autopista - Plataforma de recaudo": [
        "arm.bd.bloqueos", "arm.bd.conexiones_pct", "arm.gateway.heap_pct", "arm.gateway.reinicios", "arm.interop.enlace",
        "arm.interop.latencia_ms", "arm.conciliacion.pendientes",
    ],
    "Autopista - Corredor": ["arm.vehiculos", "arm.flujo_h", "arm.velocidad_media", "arm.cola_max_km"],
}
# Series con historial (sparklines del centro de mando): (host, clave, título, unidad)
SERIES = [
    ("Autopista - Recaudo", "arm.apm.gateway.p95", "Gateway p95", "s"),
    ("Autopista - Recaudo", "arm.apm.validacion.error_pct", "Validación TAG errores", "%"),
    ("Autopista - Plataforma de recaudo", "arm.bd.bloqueos", "BD sesiones bloqueadas", ""),
    ("Autopista - Recaudo", "arm.kpi[recaudo_1h]", "Recaudo última hora", "COP"),
    ("Autopista - Corredor", "arm.velocidad_media", "Velocidad media", "km/h"),
    ("Autopista - Corredor", "arm.cola_max_km", "Cola máxima en vía", "km"),
]

app = FastAPI(title="Autopista · Demo Zabbix 8.0")
app.add_middleware(GZipMiddleware, minimum_size=1000)
bitacora_web = collections.deque(maxlen=40)
zabbix = {"ok": False, "problemas": [], "items": {}, "series": [], "dashboard": "", "t": 0}
vistos = {}
candado = threading.Lock()


def anotar(texto, tipo="info"):
    bitacora_web.append({"t": time.time(), "txt": texto, "tipo": tipo})


def api(metodo, params):
    pedido = urllib.request.Request(
        ZABBIX_URL, data=json.dumps({"jsonrpc": "2.0", "method": metodo, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"})
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(pedido, context=ctx, timeout=10) as r:
        datos = json.load(r)
    if "error" in datos:
        raise RuntimeError(datos["error"].get("data"))
    return datos["result"]


def leer_items():
    """{clave: {valor, clock, itemid, tipo}} de los ítems de ITEMS (una consulta por host)."""
    out = {}
    for host, claves in ITEMS.items():
        for i in api("item.get", {"output": ["itemid", "key_", "lastvalue", "lastclock", "value_type", "units"], "host": host, "filter": {"key_": claves}}):
            out[i["key_"]] = {"valor": float(i["lastvalue"]) if i["lastclock"] != "0" else None, "clock": int(i["lastclock"]),
                              "itemid": i["itemid"], "tipo": int(i["value_type"]), "unidad": i["units"]}
    return out


def leer_series(items):
    """Historial de los últimos 30 min de SERIES, reducido a ~90 puntos por serie."""
    desde = int(time.time()) - 1800
    series = []
    for host, clave, titulo, unidad in SERIES:
        it = items.get(clave)
        if not it:
            continue
        filas = api("history.get", {"output": ["clock", "value"], "itemids": [it["itemid"]], "history": it["tipo"],
                                    "time_from": desde, "sortfield": "clock", "sortorder": "ASC", "limit": 2000})
        paso = max(1, len(filas) // 90)
        puntos = [[int(f["clock"]), float(f["value"])] for f in filas[::paso]]
        series.append({"clave": clave, "titulo": titulo, "unidad": unidad, "puntos": puntos, "host": host})
    return series


def sondear_zabbix():
    """Problemas de la demo (con los tags que pone el CEP), ítems y su historial, tal como los ve Zabbix."""
    ultimo_historial = 0
    while True:
        try:
            filas = api("problem.get", {
                "output": ["eventid", "name", "severity", "clock", "cause_eventid", "acknowledged"], "selectTags": "extend",
                "tags": [{"tag": "demo", "value": "autopista", "operator": 1}], "severities": [2, 3, 4, 5],
                "recent": False, "sortfield": ["eventid"], "sortorder": "DESC", "limit": 60})
            causas = {p["cause_eventid"] for p in filas if p.get("cause_eventid", "0") != "0"}
            problemas = []
            for p in filas:
                t = {x["tag"]: x["value"] for x in p.get("tags", []) if x["tag"] in TAGS_HUD}
                problemas.append({"id": p["eventid"], "nombre": p["name"], "severidad": int(p["severity"]), "desde": int(p["clock"]),
                                  "causa": p["eventid"] in causas, "sintoma": p.get("cause_eventid", "0") != "0",
                                  "de": p.get("cause_eventid", "0"), "tags": t})
            items = leer_items()
            series = None
            if time.time() - ultimo_historial > HISTORIAL_SEG:
                series = leer_series(items)
                ultimo_historial = time.time()
            enlace = zabbix["dashboard"]
            if ZABBIX_WEB_URL and not enlace:
                d = api("dashboard.get", {"output": ["dashboardid"], "filter": {"name": ["Autopista · Operación del corredor"]}})
                if d:
                    enlace = f"{ZABBIX_WEB_URL}/zabbix.php?action=dashboard.view&dashboardid={d[0]['dashboardid']}"
            with candado:
                actuales = {p["id"]: p["nombre"] for p in problemas}
                for clave, nombre in actuales.items():
                    if clave not in vistos:
                        anotar(f"Zabbix: {nombre}", "alerta")
                for clave, nombre in vistos.items():
                    if clave not in actuales:
                        anotar(f"Zabbix resolvió: {nombre}", "ok")
                vistos.clear()
                vistos.update(actuales)
                zabbix.update(ok=True, problemas=problemas, items=items, dashboard=enlace, t=time.time())
                if series is not None:
                    zabbix["series"] = series
        except (OSError, ValueError, KeyError, RuntimeError) as e:
            with candado:
                if zabbix["ok"]:
                    anotar(f"Sin conexión con Zabbix ({type(e).__name__})", "alerta")
                zabbix["ok"] = False
        time.sleep(SONDEO_SEG)


if ZABBIX_URL and ZABBIX_API_TOKEN:
    threading.Thread(target=sondear_zabbix, daemon=True).start()


def json_resp(cuerpo):
    return Response(json.dumps(cuerpo, ensure_ascii=False, separators=(",", ":")), media_type="application/json")


def valor(items, clave):
    it = items.get(clave)
    return it["valor"] if it else None


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/api/estado")
def api_estado():
    try:
        mundo = json.loads(estado.MUNDO.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HTTPException(503, "El simulador todavía no arrancó")
    with candado:
        z = {"ok": zabbix["ok"], "problemas": list(zabbix["problemas"]), "items": dict(zabbix["items"]), "dashboard": zabbix["dashboard"]}
        propia = list(bitacora_web)
    kpi = mundo["kpi"]
    # con Zabbix conectado, el recaudo y el APM del HUD son los que Zabbix calcula desde las trazas
    if valor(z["items"], "arm.kpi[recaudo_hoy]") is not None:
        kpi["recaudo_hoy"] = int(valor(z["items"], "arm.kpi[recaudo_hoy]"))
        kpi["transacciones_hoy"] = int(valor(z["items"], "arm.kpi[transacciones_hoy]") or kpi["transacciones_hoy"])
        kpi["tag_pct"] = round(valor(z["items"], "arm.kpi[tag_pct_hoy]") or kpi["tag_pct"], 1)
        kpi["fuente_recaudo"] = "zabbix"
    if valor(z["items"], "arm.apm.gateway.p95") is not None:
        kpi["latencia_ms"] = round(valor(z["items"], "arm.apm.gateway.p95") * 1000)
        kpi["errores_pct"] = round(valor(z["items"], "arm.apm.gateway.error_pct") or 0, 1)
    ensayo = [{**p, "sintoma": not p["causa"], "tags": {}} for p in mundo.get("problemas_ensayo", [])] if ENSAYO else []
    problemas = z["problemas"] if z["ok"] else ensayo
    mundo.pop("problemas_ensayo", None)
    mundo["bitacora"] = sorted(mundo.get("bitacora", []) + propia, key=lambda e: e["t"])[-40:]
    return json_resp({**mundo, "problemas": problemas, "zabbix_ok": z["ok"], "ensayo": ENSAYO and not z["ok"], "controles": CONTROLES,
                      "dashboard": z["dashboard"], "catalogo": estado.CATALOGO, "velocidades": estado.VELOCIDADES})


@app.get("/api/zabbix")
def api_zabbix():
    """Lo que ve Zabbix: problemas con los tags del CEP, conteo por severidad, ítems y su historial."""
    with candado:
        z = {k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v) for k, v in zabbix.items()}
    severidades = {s: sum(1 for p in z["problemas"] if p["severidad"] == s) for s in (2, 3, 4, 5)}
    items = {k: {"valor": v["valor"], "clock": v["clock"], "unidad": v["unidad"]} for k, v in z["items"].items()}
    return json_resp({"ok": z["ok"], "t": z["t"], "problemas": z["problemas"], "severidades": severidades, "items": items,
                      "series": z["series"], "dashboard": z["dashboard"], "zabbix_web": ZABBIX_WEB_URL})


def llamar_control(ruta):
    if not CONTROLES:
        raise HTTPException(403, "Controles deshabilitados")
    try:
        r = httpx.post(f"{CONTROL}{ruta}", headers={"Authorization": f"Bearer {CONTROL_TOKEN}"}, timeout=8)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Control no disponible: {type(e).__name__}")
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.json().get("mensaje", "Error del control"))
    return r.json()


@app.post("/api/escenario/{nombre}")
def api_escenario(nombre: str):
    return llamar_control(f"/escenario/{nombre}")


@app.post("/api/escenario/{nombre}/apagar")
def api_apagar(nombre: str):
    return llamar_control(f"/escenario/{nombre}/apagar")


@app.post("/api/reset")
def api_reset():
    return llamar_control("/reset")


@app.post("/api/velocidad/{valor_}")
def api_velocidad(valor_: str):
    return llamar_control(f"/velocidad/{valor_}")


app.mount("/static", StaticFiles(directory=AQUI / "static"), name="static")


@app.get("/")
def inicio():
    return FileResponse(AQUI / "static" / "index.html")


@app.get("/peaje")
def peaje():
    return FileResponse(AQUI / "static" / "peaje.html")


@app.get("/cco")
def cco():
    return FileResponse(AQUI / "static" / "cco.html")
