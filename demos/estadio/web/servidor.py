"""Backend de la escena pixel art: sirve la webapp, une el estado de la simulación con los problemas reales de Zabbix
y reenvía las acciones al servicio de control (el token nunca llega al navegador)."""
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

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
import estado_demo as estado  # noqa: E402

AQUI = pathlib.Path(__file__).resolve().parent
CONTROL = os.environ.get("CONTROL_URL_INTERNA", "http://127.0.0.1:8091")
CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
BOLETERIA = os.environ.get("BOLETERIA_URL", "http://127.0.0.1:8201")
ACCESOS = os.environ.get("ACCESOS_URL", "http://127.0.0.1:8202")
TIENDA = os.environ.get("TIENDA_URL", "http://127.0.0.1:8203")
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
CONTROLES = os.environ.get("ESTADIO_CONTROLES", "1") == "1"
ENSAYO = os.environ.get("ESTADIO_ENSAYO", "0") == "1"
SONDEO_SEG = 5
MAX_PEDIDOS_SEG = 5

app = FastAPI(title="Estadio Zabbix")
bitacora_web = collections.deque(maxlen=40)
zabbix = {"ok": False, "problemas": []}
vistos = {}
candado = threading.Lock()
ventana_pedidos = collections.deque()


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
    """Trae los problemas de la demo tal como los ve Zabbix, con la causa y los síntomas que marcó CEP."""
    while True:
        try:
            filas = api("problem.get", {
                "output": ["eventid", "name", "severity", "clock", "cause_eventid"],
                "tags": [{"tag": "demo", "value": "estadio", "operator": 1}], "severities": [2, 3, 4, 5],
                "recent": False, "sortfield": ["eventid"], "sortorder": "DESC", "limit": 25})
            causas = {p["cause_eventid"] for p in filas if p.get("cause_eventid", "0") != "0"}
            problemas = [{"id": p["eventid"], "nombre": p["name"], "severidad": int(p["severity"]), "desde": int(p["clock"]),
                          "causa": p["eventid"] in causas, "sintoma": p.get("cause_eventid", "0") != "0"} for p in filas]
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
                zabbix.update(ok=True, problemas=problemas)
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
        z = {"ok": zabbix["ok"], "problemas": list(zabbix["problemas"])}
        propia = list(bitacora_web)
    ensayo = [{**p, "sintoma": not p["causa"]} for p in mundo.get("problemas_ensayo", [])] if ENSAYO else []
    problemas = z["problemas"] if z["ok"] else ensayo
    mundo.pop("problemas_ensayo", None)
    mundo["bitacora"] = sorted(mundo.get("bitacora", []) + propia, key=lambda e: e["t"])[-40:]
    mundo["latencia"] = estado.leer(estado.LATENCIA, {})
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


ACCIONES = {
    "entrada": (f"{BOLETERIA}/entrada", {"sector": "Platea", "canal": "demo"}, "boleteria", "La boletería no responde"),
    "acceso": (f"{ACCESOS}/validar", {"puerta": "Norte", "canal": "demo"}, "accesos", "El molinete no responde"),
    "merch": (f"{TIENDA}/compra", {"producto": "Camiseta titular", "canal": "demo"}, "tienda", "La tienda no responde"),
}


@app.post("/api/accion/{nombre}")
def api_accion(nombre: str):
    """El clic en la boletería, un molinete o la tienda: una operación real por los servicios, con su traza."""
    if nombre not in ACCIONES:
        raise HTTPException(404, "Acción desconocida")
    url, cuerpo, paso, sin_respuesta = ACCIONES[nombre]
    ahora = time.time()
    with candado:
        while ventana_pedidos and ventana_pedidos[0] < ahora - 1:
            ventana_pedidos.popleft()
        if len(ventana_pedidos) >= MAX_PEDIDOS_SEG:
            raise HTTPException(429, "Demasiados pedidos por segundo")
        ventana_pedidos.append(ahora)
    inicio = time.monotonic()
    try:
        datos = httpx.post(url, json=cuerpo, timeout=15).json()
    except (httpx.HTTPError, ValueError):
        datos = {"ok": False, "paso": paso, "error": sin_respuesta, "trace_id": ""}
    ms = round((time.monotonic() - inicio) * 1000)
    traza = datos.get("trace_id", "")[:8]
    if datos.get("ok"):
        detalle = {"entrada": lambda d: f"Entrada {d['entrada']} vendida", "acceso": lambda d: f"Ingreso por puerta {d['puerta']}",
                   "merch": lambda d: f"{d['producto']} vendida"}[nombre](datos)
        anotar(f"{detalle} · {ms} ms · traza {traza}", "ok")
    else:
        anotar(f"Falló {nombre} en {datos.get('paso')} · traza {traza}", "alerta")
    return {**datos, "ms": ms}


app.mount("/static", StaticFiles(directory=AQUI / "static"), name="static")


@app.get("/")
def inicio():
    return FileResponse(AQUI / "static" / "index.html")
