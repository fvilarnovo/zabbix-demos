#!/usr/bin/env python3
"""Servidor de control de la demo del hotel (solo biblioteca estándar).

Corre dentro del contenedor y expone por HTTP los mismos actos que el demo.sh original.
Toda ruta salvo GET /salud exige "Authorization: Bearer <CONTROL_TOKEN>".
"""
import hmac
import json
import os
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
CONTROL_PORT = int(os.environ.get("CONTROL_PORT") or 8091)
SIM_OT = os.environ.get("SIM_OT") or "/srv/sim/ot/hotel_ot_sim.py"
SIM_ANOMALIA = os.environ.get("SIM_ANOMALIA") or "/srv/sim/finops/anomalia.py"
HOTEL_URL = (os.environ.get("HOTEL_URL") or "http://127.0.0.1:8000").rstrip("/")
PIXEL_URL = (os.environ.get("PIXEL_URL") or "http://127.0.0.1:8090").rstrip("/")
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")

MODOS = ("normal", "promo", "pagos-lentos", "pagos-error")
ESCENARIOS = ("corte", "elevador", "normal")
NUBES = ("gcp", "aws")
GRUPOS = ["Hotel/Negocio", "Hotel/OT", "Hotel/Cloud", "Applications/APM/hotel"]
REGLAS = ["Hotel: causa y síntomas de energía", "Hotel: incidente eléctrico"]
ANTIGUEDAD_MAX_KPI = 90
ANTIGUEDAD_MAX_OT = 30
ANTIGUEDAD_MAX_COSTO = 60
NOTA_RESET = ("Tras una falla de pagos, los problemas de APM tardan varios minutos en resolverse "
              "(usan una ventana de 5 min). Luego corre check.")


class ErrorDemo(Exception):
    """Error de un servicio de la demo; se responde 502."""


def api(method, params):
    if not ZABBIX_URL:
        raise ErrorDemo("ZABBIX_URL no está definida")
    req = urllib.request.Request(
        ZABBIX_URL,
        data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"},
    )
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        data = json.load(r)
    if "error" in data:
        e = data["error"]
        raise ErrorDemo(f"Zabbix {method}: {e.get('message', '')} {e.get('data', '')}".strip())
    return data["result"]


def http_ok(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status == 200
    except (OSError, ValueError):
        return False


def cambiar_modo(modo):
    req = urllib.request.Request(f"{HOTEL_URL}/demo/modo", data=urllib.parse.urlencode({"modo": modo}).encode())
    try:
        with urllib.request.urlopen(req, timeout=5):
            pass
    except (OSError, ValueError) as e:
        raise ErrorDemo(f"no se pudo cambiar el modo en la webapp del hotel ({HOTEL_URL}): {e}")
    return f"OK modo {modo}"


def ejecutar(args):
    try:
        p = subprocess.run(["python3", *args], capture_output=True, text=True, timeout=60, check=False)
    except subprocess.TimeoutExpired:
        raise ErrorDemo(f"tiempo agotado (60 s) ejecutando {os.path.basename(args[0])} {' '.join(args[1:])}")
    except OSError as e:
        raise ErrorDemo(f"no se pudo ejecutar {args[0]}: {e}")
    salida = (p.stdout + p.stderr).strip()
    if p.returncode != 0:
        raise ErrorDemo(f"{os.path.basename(args[0])} {' '.join(args[1:])} terminó con código {p.returncode}: {salida[-500:]}")
    return salida


def escenario_ot(esc):
    salida = ejecutar([SIM_OT, "escenario", esc])
    return f"OK escenario {esc}" + (f": {salida}" if salida else "")


def anomalia(accion, nube):
    return ejecutar([SIM_ANOMALIA, accion, nube])


def act3(nube):
    if nube == "normal":
        for n in NUBES:
            anomalia("quitar", n)
        return "OK anomalías de costo quitadas (gcp y aws)"
    anomalia("activar", nube)
    return f"OK anomalía de costo activada en {nube}"


def antiguedad(host, clave):
    i = api("item.get", {"output": ["lastclock"], "host": host, "filter": {"key_": [clave]}})
    return time.time() - int(i[0]["lastclock"]) if i and i[0]["lastclock"] != "0" else float("inf")


def comprobaciones():
    res = []

    def informe(ok, texto):
        res.append({"ok": bool(ok), "texto": texto})

    def intentar(texto_error, fn):
        try:
            fn()
        except (ErrorDemo, OSError, ValueError, KeyError, IndexError) as e:
            informe(False, f"{texto_error}: {type(e).__name__}: {e}")

    informe(http_ok(f"{HOTEL_URL}/salud"), "webapp del hotel")
    informe(http_ok(f"{PIXEL_URL}/api/estado"), "vista pixel")

    def edad(host, clave, maximo, etiqueta):
        def f():
            e = antiguedad(host, clave)
            informe(e < maximo, f"{etiqueta} al día (hace {e:.0f} s)")
        intentar(f"{etiqueta} (API de Zabbix)", f)

    edad("Hotel Gran Forum - Negocio", "hotel.kpi[visitas_hoy]", ANTIGUEDAD_MAX_KPI, "KPI de negocio")
    edad("Hotel Gran Forum - OT", "hotel.grid.state", ANTIGUEDAD_MAX_OT, "datos OT")
    edad("AWS Cost", "aws.daily.service.total.cost", ANTIGUEDAD_MAX_COSTO, "costos AWS")

    def reglas():
        r = api("ceprule.get", {"output": ["name", "status"], "filter": {"name": REGLAS}})
        informe(len(r) == len(REGLAS) and all(x["status"] == "0" for x in r), "reglas CEP activas")
    intentar("reglas CEP (API de Zabbix)", reglas)

    def problemas():
        grupos = [g["groupid"] for g in api("hostgroup.get", {"output": ["groupid"], "filter": {"name": GRUPOS}})]
        abiertos = api("problem.get", {"output": ["name"], "groupids": grupos})
        informe(not abiertos, f"sin problemas abiertos en el hotel ({len(abiertos)})")
        for p in abiertos[:8]:
            res.append({"ok": True, "texto": f"    problema abierto: {p['name']}", "detalle": True})
    intentar("problemas abiertos (API de Zabbix)", problemas)
    return res


def texto_check(res):
    lineas = [f"{'BIEN' if c['ok'] else 'MAL '}  {c['texto']}" if not c.get("detalle") else f"        {c['texto'].strip()}"
              for c in res]
    lineas.append("NOTA  El límite de la ventana CEP no se puede comprobar desde aquí; evita lanzar un corte justo en el cambio de hora de la ventana.")
    fallos = sum(1 for c in res if not c["ok"])
    lineas.append("")
    lineas.append("Todo listo." if not fallos else f"{fallos} comprobaciones con problemas.")
    return "\n".join(lineas) + "\n", fallos


class Manejador(BaseHTTPRequestHandler):
    server_version = "ControlHotel/1.0"

    def log_message(self, fmt, *args):  # se registra a mano, sin cabeceras
        pass

    def _responder(self, codigo, cuerpo, tipo="application/json; charset=utf-8"):
        data = cuerpo if isinstance(cuerpo, bytes) else (
            cuerpo.encode() if isinstance(cuerpo, str) else json.dumps(cuerpo, ensure_ascii=False).encode())
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        print(f"{self.command} {self.path.split('?')[0]} {codigo}", flush=True)

    def _json(self, codigo, ok, mensaje, **extra):
        self._responder(codigo, {"ok": ok, "mensaje": mensaje, **extra})

    def _autorizado(self):
        if not CONTROL_TOKEN:
            self._json(503, False, "El servidor no tiene CONTROL_TOKEN configurado; defínelo y reinicia el control.")
            return False
        cab = self.headers.get("Authorization", "")
        esquema, _, token = cab.partition(" ")
        if esquema.lower() != "bearer" or not hmac.compare_digest(token.strip().encode(), CONTROL_TOKEN.encode()):
            self._json(401, False, "No autorizado: falta o es inválido el token Bearer.")
            return False
        return True

    def _despachar(self, metodo):
        ruta = self.path.split("?")[0].rstrip("/") or "/"
        if metodo == "GET" and ruta == "/salud":
            return self._json(200, True, "El control está activo.")
        if not self._autorizado():
            return
        partes = ruta.strip("/").split("/")
        try:
            if metodo == "GET" and ruta == "/check":
                return self._check()
            if metodo == "POST" and len(partes) == 2:
                grupo, valor = partes
                if grupo == "act1" and valor in MODOS:
                    return self._json(200, True, cambiar_modo(valor))
                if grupo == "act2" and valor in ESCENARIOS:
                    return self._json(200, True, escenario_ot(valor))
                if grupo == "act3" and (valor in NUBES or valor == "normal"):
                    return self._json(200, True, act3(valor))
            if metodo == "POST" and ruta == "/reset":
                partes_msg = [cambiar_modo("normal"), escenario_ot("normal"), act3("normal"), NOTA_RESET]
                return self._json(200, True, "\n".join(partes_msg))
        except ErrorDemo as e:
            return self._json(502, False, str(e))
        except Exception as e:  # nunca dejar la conexión colgada
            return self._json(500, False, f"Error interno: {type(e).__name__}: {e}")
        self._json(404, False, f"Ruta no encontrada: {metodo} {ruta}")

    def _check(self):
        res = comprobaciones()
        texto, fallos = texto_check(res)
        if "text/plain" in self.headers.get("Accept", ""):
            return self._responder(200, texto, "text/plain; charset=utf-8")
        self._responder(200, {"ok": fallos == 0, "mensaje": texto.strip().splitlines()[-1],
                              "comprobaciones": [{"ok": c["ok"], "texto": c["texto"].strip()} for c in res],
                              "texto": texto})

    def do_GET(self):
        self._despachar("GET")

    def do_POST(self):
        self._despachar("POST")


def main():
    if not CONTROL_TOKEN:
        print("AVISO: CONTROL_TOKEN vacío; solo responderá /salud (503 en el resto).", flush=True)
    srv = ThreadingHTTPServer(("0.0.0.0", CONTROL_PORT), Manejador)
    srv.daemon_threads = True
    print(f"Control del hotel escuchando en 0.0.0.0:{CONTROL_PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
