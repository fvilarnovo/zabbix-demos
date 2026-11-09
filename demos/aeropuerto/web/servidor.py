"""Backend de la escena 3D: sirve la webapp, une el estado de la simulación con los problemas reales de Zabbix y
reenvía las acciones al servicio de control (el token nunca llega al navegador)."""
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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import estado_demo as estado  # noqa: E402

AQUI = pathlib.Path(__file__).resolve().parent
CONTROL = os.environ.get("CONTROL_URL_INTERNA", "http://127.0.0.1:8091")
CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
KIOSCO = os.environ.get("KIOSCO_URL", "http://127.0.0.1:8101")
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
CONTROLES = os.environ.get("AEROPUERTO_CONTROLES", "1") == "1"
ENSAYO = os.environ.get("AEROPUERTO_ENSAYO", "0") == "1"
SONDEO_SEG = 5
HOST_NEGOCIO = "Aeropuerto - Negocio"
MAX_CHECKINS_SEG = 5

app = FastAPI(title="Aeropuerto")
bitacora_web = collections.deque(maxlen=40)
zabbix = {"ok": False, "problemas": [], "kpi": {}}
vistos = {}
candado = threading.Lock()
ventana_checkins = collections.deque()


def anotar(texto, tipo="info"):
    bitacora_web.append({"t": time.time(), "txt": texto, "tipo": tipo})


def api(metodo, params):
    pedido = urllib.request.Request(
        ZABBIX_URL, data=json.dumps({"jsonrpc": "2.0", "method": metodo, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"})
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(pedido, context=ctx, timeout=8) as r:
        datos = json.load(r)
    if "error" in datos:
        raise RuntimeError(datos["error"].get("data"))
    return datos["result"]


def sondear_zabbix():
    """Trae los problemas de la demo y los ítems que el HUD muestra tal como los ve Zabbix."""
    while True:
        try:
            filas = api("problem.get", {
                "output": ["eventid", "name", "severity", "clock", "cause_eventid"],
                "tags": [{"tag": "demo", "value": "aeropuerto", "operator": 1}], "severities": [2, 3, 4, 5],
                "recent": False, "sortfield": ["eventid"], "sortorder": "DESC", "limit": 25})
            causas = {p["cause_eventid"] for p in filas if p.get("cause_eventid", "0") != "0"}
            problemas = [{"id": p["eventid"], "nombre": p["name"], "severidad": int(p["severity"]), "desde": int(p["clock"]),
                          "causa": p["eventid"] in causas, "sintoma": p.get("cause_eventid", "0") != "0"} for p in filas]
            items = api("item.get", {"output": ["key_", "lastvalue", "lastclock"], "host": HOST_NEGOCIO,
                                     "filter": {"key_": ["aero.apm.checkin.p95", "aero.apm.pasajes.error_pct"]}})
            kpi = {i["key_"]: float(i["lastvalue"]) for i in items if i["lastclock"] != "0"}
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
                zabbix.update(ok=True, problemas=problemas, kpi=kpi)
        except (OSError, ValueError, KeyError, RuntimeError) as e:
            with candado:
                if zabbix["ok"]:
                    anotar(f"Sin conexión con Zabbix ({type(e).__name__})", "alerta")
                zabbix["ok"] = False
        time.sleep(SONDEO_SEG)


if ZABBIX_URL and ZABBIX_API_TOKEN:
    threading.Thread(target=sondear_zabbix, daemon=True).start()


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/api/estado")
def api_estado():
    mundo = estado.leer(estado.MUNDO, {})
    if not mundo:
        raise HTTPException(503, "El simulador todavía no arrancó")
    with candado:
        z = {"ok": zabbix["ok"], "problemas": list(zabbix["problemas"]), "kpi": dict(zabbix["kpi"])}
        propia = list(bitacora_web)
    kpi = mundo["kpi"]
    if "aero.apm.checkin.p95" in z["kpi"]:
        kpi["latencia_ms"] = round(z["kpi"]["aero.apm.checkin.p95"] * 1000)
    if "aero.apm.pasajes.error_pct" in z["kpi"]:
        kpi["errores_pct"] = round(z["kpi"]["aero.apm.pasajes.error_pct"], 1)
    ensayo = [{**p, "sintoma": not p["causa"]} for p in mundo.get("problemas_ensayo", [])] if ENSAYO else []
    problemas = z["problemas"] if z["ok"] else ensayo
    mundo.pop("problemas_ensayo", None)
    mundo["bitacora"] = sorted(mundo.get("bitacora", []) + propia, key=lambda e: e["t"])[-40:]
    return {**mundo, "problemas": problemas, "zabbix_ok": z["ok"], "ensayo": ENSAYO and not z["ok"], "controles": CONTROLES}


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


@app.post("/api/reset")
def api_reset():
    return llamar_control("/reset")


@app.post("/api/velocidad/{valor}")
def api_velocidad(valor: str):
    return llamar_control(f"/velocidad/{valor}")


class PedidoCheckin(BaseModel):
    vuelo: str = "ZB410"
    valijas: int = 1


@app.post("/api/checkin")
def api_checkin(pedido: PedidoCheckin):
    """El clic en un pasajero: hace un check-in real por toda la cadena de servicios y devuelve su traza."""
    ahora = time.time()
    with candado:
        while ventana_checkins and ventana_checkins[0] < ahora - 1:
            ventana_checkins.popleft()
        if len(ventana_checkins) >= MAX_CHECKINS_SEG:
            raise HTTPException(429, "Demasiados check-ins por segundo")
        ventana_checkins.append(ahora)
    inicio = time.monotonic()
    try:
        r = httpx.post(f"{KIOSCO}/checkin", json={"vuelo": pedido.vuelo, "valijas": pedido.valijas, "canal": "demo"}, timeout=15)
        datos = r.json()
    except (httpx.HTTPError, ValueError):
        datos = {"ok": False, "paso": "kiosco", "error": "El kiosco no responde", "trace_id": ""}
    ms = round((time.monotonic() - inicio) * 1000)
    traza = datos.get("trace_id", "")[:8]
    if datos.get("ok"):
        anotar(f"Check-in {pedido.vuelo} asiento {datos['asiento']} · {ms} ms · traza {traza}", "ok")
    else:
        anotar(f"Check-in falló en {datos.get('paso')} · {ms} ms · traza {traza}", "alerta")
    return {**datos, "ms": ms}


app.mount("/static", StaticFiles(directory=AQUI / "static"), name="static")


@app.get("/")
def inicio():
    return FileResponse(AQUI / "static" / "index.html")
