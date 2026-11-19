#!/usr/bin/env python3
"""Servicio de control de la demo (solo biblioteca estándar). Toda ruta salvo GET /salud exige Bearer CONTROL_TOKEN.

  POST /escenario/<nombre>          activa un escenario del catálogo
  POST /escenario/<nombre>/apagar   apaga un escenario
  POST /velocidad/<valor>           0.5, 1, 2, 4 u 8
  POST /reset                       todo a la normalidad y cierra las ventanas CEP de todas las zonas
  GET  /check                       comprobación previa a la demo
"""
import hmac
import json
import os
import ssl
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import estado_demo as estado  # noqa: E402
from zbx_sender import ZabbixSender  # noqa: E402

CONTROL_TOKEN = os.environ.get("CONTROL_TOKEN", "")
CONTROL_PORT = int(os.environ.get("CONTROL_PORT_INTERNO") or 8091)
ZABBIX_URL = os.environ.get("ZABBIX_URL", "")
ZABBIX_API_TOKEN = os.environ.get("ZABBIX_API_TOKEN", "")
TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
HOST_CORREDOR = "Autopista - Corredor"
ZONAS = ("UF1", "UF2", "UF3", "UF4", "central")
ESPERA_REINICIO = 3
REGLAS = ["Autopista: responsable por nivel", "Autopista: causa y síntomas por zona", "Autopista: incidente corte de fibra UF-2",
          "Autopista: incidente accidente con cola", "Autopista: incidente peaje sin energía", "Autopista: incidente recaudo degradado"]
candado = threading.Lock()


def reiniciar_ventanas():
    """Evento de control por zona: cierra las ventanas CEP para que la próxima falla sea causa y no síntoma de la anterior."""
    if not TRAPPER_HOST:
        return
    sender = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT)
    for valor in (1, 0):
        sender.send_batch([{"host": HOST_CORREDOR, "key": f"arm.cep.reinicio[{z}]", "value": valor} for z in ZONAS])
        time.sleep(ESPERA_REINICIO)


def api(metodo, params):
    pedido = urllib.request.Request(
        ZABBIX_URL, data=json.dumps({"jsonrpc": "2.0", "method": metodo, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {ZABBIX_API_TOKEN}"})
    ctx = ssl._create_unverified_context() if ZABBIX_URL.lower().startswith("https") else None
    with urllib.request.urlopen(pedido, context=ctx, timeout=15) as r:
        datos = json.load(r)
    if "error" in datos:
        raise RuntimeError(f"{metodo}: {datos['error'].get('data')}")
    return datos["result"]


def comprobaciones():
    res = []

    def informe(ok, texto):
        res.append({"ok": bool(ok), "texto": texto})

    mundo = estado.leer(estado.MUNDO, {})
    informe(time.time() - mundo.get("ts", 0) < 10, "simulador al día")
    kpi = mundo.get("kpi", {})
    informe(kpi.get("vehiculos", 0) > 50, f"tránsito en el corredor ({kpi.get('vehiculos', 0)} vehículos)")
    informe(kpi.get("latencia_ms", 0) > 0, f"transacciones reales contra la app de recaudo (p95 {kpi.get('latencia_ms', 0)} ms)")
    if not ZABBIX_URL or not ZABBIX_API_TOKEN:
        informe(False, "API de Zabbix sin configurar")
        return res
    try:
        for host, clave, maximo, etiqueta in (
                (HOST_CORREDOR, "arm.vehiculos", 30, "datos del corredor"),
                ("Autopista - Peaje Vegachi", "arm.peaje.cola_max", 30, "datos de peajes"),
                ("Autopista - ITS dai-k099", "its.en_linea", 30, "datos ITS"),
                ("Autopista - Recaudo", "arm.kpi.get", 120, "KPI de recaudo desde las trazas"),
                ("Autopista - Recaudo", "arm.apm.gateway.total", 120, "APM (Telemetry query)")):
            i = api("item.get", {"output": ["lastclock", "error", "state"], "host": host, "filter": {"key_": [clave]}})
            edad = time.time() - int(i[0]["lastclock"]) if i and i[0]["lastclock"] != "0" else float("inf")
            error = (i[0].get("error") or "")[:300] if i else "ítem inexistente"
            informe(edad < maximo, f"{etiqueta} al día (hace {edad:.0f} s)" + (f" · error: {error}" if edad >= maximo and error else ""))
        r = api("ceprule.get", {"output": ["name", "status", "error"], "filter": {"name": REGLAS}})
        informe(len(r) == len(REGLAS) and all(x["status"] == "0" and not x.get("error") for x in r), f"reglas CEP activas ({len(r)}/{len(REGLAS)})")
        abiertos = api("problem.get", {"output": ["name"], "tags": [{"tag": "demo", "value": "autopista", "operator": 1}], "severities": [2, 3, 4, 5]})
        informe(not abiertos, f"sin problemas abiertos ({len(abiertos)})")
    except (OSError, ValueError, KeyError, IndexError, RuntimeError) as e:
        informe(False, f"API de Zabbix: {type(e).__name__}: {e}")
    return res


class Manejador(BaseHTTPRequestHandler):
    server_version = "ControlAutopista/1.0"

    def log_message(self, fmt, *args):
        pass

    def _json(self, codigo, cuerpo):
        datos = json.dumps(cuerpo, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)
        print(f"{self.command} {self.path} {codigo}", flush=True)

    def _autorizado(self):
        if not CONTROL_TOKEN:
            self._json(503, {"ok": False, "mensaje": "CONTROL_TOKEN sin configurar"})
            return False
        esquema, _, token = self.headers.get("Authorization", "").partition(" ")
        if esquema.lower() != "bearer" or not hmac.compare_digest(token.strip().encode(), CONTROL_TOKEN.encode()):
            self._json(401, {"ok": False, "mensaje": "No autorizado"})
            return False
        return True

    def do_GET(self):
        if self.path == "/salud":
            return self._json(200, {"ok": True})
        if not self._autorizado():
            return
        if self.path == "/check":
            res = comprobaciones()
            return self._json(200, {"ok": all(c["ok"] for c in res), "comprobaciones": res})
        self._json(404, {"ok": False, "mensaje": "Ruta no encontrada"})

    def do_POST(self):
        if not self._autorizado():
            return
        partes = self.path.strip("/").split("/")
        try:
            with candado:
                if partes == ["reset"]:
                    estado.restablecer()
                    threading.Thread(target=reiniciar_ventanas, daemon=True).start()
                    return self._json(200, {"ok": True, "mensaje": "Reset"})
                if len(partes) == 2 and partes[0] == "escenario":
                    estado.activar(partes[1])
                    return self._json(200, {"ok": True, "mensaje": estado.CATALOGO[partes[1]]})
                if len(partes) == 3 and partes[0] == "escenario" and partes[2] == "apagar":
                    estado.desactivar(partes[1])
                    return self._json(200, {"ok": True, "mensaje": f"Fin: {estado.CATALOGO[partes[1]]}"})
                if len(partes) == 2 and partes[0] == "velocidad":
                    estado.fijar_velocidad(float(partes[1]))
                    return self._json(200, {"ok": True, "mensaje": f"Velocidad {partes[1]}x"})
        except ValueError as e:
            return self._json(400, {"ok": False, "mensaje": str(e)})
        except OSError as e:
            return self._json(500, {"ok": False, "mensaje": f"{type(e).__name__}: {e}"})
        self._json(404, {"ok": False, "mensaje": "Ruta no encontrada"})


def main():
    threading.Thread(target=reiniciar_ventanas, daemon=True).start()
    servidor = ThreadingHTTPServer(("0.0.0.0", CONTROL_PORT), Manejador)
    servidor.daemon_threads = True
    print(f"Control escuchando en 0.0.0.0:{CONTROL_PORT}", flush=True)
    servidor.serve_forever()


if __name__ == "__main__":
    main()
