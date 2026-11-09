#!/usr/bin/env python3
"""Hotel Gran Zabbix 8.0, vista pixel art: sirve la escena y le entrega el estado de los actos de la demo.

Solo usa la biblioteca estándar, para correr igual en el contenedor y en la Mac.

  servidor.py                   lee el estado real de la demo (lo que cambia el servicio de control)
  servidor.py --ensayo          estado en memoria, sin tocar la demo ni Zabbix; se maneja con el teclado de la escena

No modifica nada de la demo. Lee:
  - GET {HOTEL_URL}/demo/estado            acto 1: modo de pagos y ocupación
  - {OT_ESTADO} + valores() del simulador  acto 2: la misma línea de tiempo que recibe Zabbix
  - {DIR_ANOMALIAS}/anomalia_*             acto 3: anomalías de costo activas
Las reservas pasan por hotel-web, con la cookie y el User-Agent del navegador, para que cuenten como una
reserva más y su traza se encuentre con los filtros del guion.
"""
import argparse
import html
import importlib.util
import json
import mimetypes
import os
import pathlib
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

RAIZ = pathlib.Path(__file__).resolve().parent
WEB = RAIZ / "web"

HOTEL_URL = os.environ.get("HOTEL_URL", "http://127.0.0.1:8000")
ESTADO_DIR = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado"))
OT_ESTADO = pathlib.Path(os.environ.get("OT_ESTADO", str(ESTADO_DIR / "ot_escenario.json")))
DIR_ANOMALIAS = pathlib.Path(os.environ.get("DIR_ANOMALIAS", str(ESTADO_DIR / "finops")))
OT_SIM = [pathlib.Path(p) for p in (
    os.environ.get("OT_SIM", ""),
    "/srv/sim/ot/hotel_ot_sim.py",
    str(RAIZ.parent / "sim" / "ot" / "hotel_ot_sim.py"),
    "/opt/demo-hotel/ot/hotel_ot_sim.py",
) if p]

MODOS = ("normal", "promo", "pagos-lentos", "pagos-error")
TIPOS = {"estandar": ("Estándar", 2400), "superior": ("Superior", 3600), "suite": ("Suite Forum", 7200)}
RE_CODIGO = re.compile(r'class="codigo">([^<]+)<')
RE_MENSAJE = re.compile(r"<p[^>]*>([^<]*(?:pago|cargo|datos)[^<]*)</p>", re.I)


def cargar_simulador():
    """Reutiliza el simulador OT: así la escena y Zabbix ven siempre los mismos umbrales y escenarios."""
    for ruta in OT_SIM:
        if ruta.exists():
            spec = importlib.util.spec_from_file_location("hotel_ot_sim", ruta)
            modulo = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(modulo)
            modulo.ESTADO = OT_ESTADO
            return modulo
    raise SystemExit("No encuentro hotel_ot_sim.py. Indica su ruta con la variable OT_SIM.")


def resumir_ot(valores, corte, elevador):
    """Pasa los ítems del simulador a la forma que usa la escena. corte y elevador: segundos desde que empezaron."""
    v = valores(corte, elevador, time.time())
    return {
        "corte_s": corte,
        "elevador_s": elevador,
        "red": v["hotel.grid.state"],
        "voltaje": v["hotel.grid.voltage"],
        "ups_bateria": v["hotel.ups.on_battery"],
        "ups_pct": v["hotel.ups.battery_pct"],
        "ups_min": v["hotel.ups.runtime_min"],
        "gen": v["hotel.gen.state"],
        "gen_bat": v["hotel.gen.start_battery_v"],
        "chiller": v["hotel.hvac.chiller_state"],
        "temp_lobby": v["hotel.hvac.lobby_temp"],
        "elev": [v[f"hotel.elev.state[{i}]"] for i in (1, 2, 3)],
        "aps": v["hotel.wifi.aps_up"],
        "clientes": v["hotel.wifi.clients"],
    }


class FuenteReal:
    """Lee el estado que deja el servicio de control y reserva a través de hotel-web. Con controles, también lanza los actos."""

    ensayo = False

    def __init__(self, sim, controles):
        self.sim = sim
        self.valores = sim.valores
        self.controles = controles

    def ordenar(self, orden):
        """Lo mismo que hace el servicio de control, pero desde el teclado de la escena. Pulsar de nuevo un escenario lo quita."""
        if orden in MODOS:
            self.fijar_modo(orden)
        elif orden in ("corte", "elevador"):
            actual = self.sim.leer_estado()
            if orden in actual:
                actual.pop(orden)
                self.sim.guardar_estado(actual)
            else:
                # escenario() cierra antes las ventanas CEP, como cuando lo lanza el servicio de control
                self.sim.escenario(orden)
        elif orden in ("gcp", "aws"):
            DIR_ANOMALIAS.mkdir(parents=True, exist_ok=True)
            marca = DIR_ANOMALIAS / f"anomalia_{orden}"
            if marca.exists():
                marca.unlink()
            else:
                marca.touch()
        elif orden == "reset":
            self.fijar_modo("normal")
            self.sim.escenario("normal")
            for nube in ("gcp", "aws"):
                (DIR_ANOMALIAS / f"anomalia_{nube}").unlink(missing_ok=True)
        else:
            return False
        return True

    def fijar_modo(self, modo):
        cuerpo = urllib.parse.urlencode({"modo": modo}).encode()
        urllib.request.urlopen(urllib.request.Request(f"{HOTEL_URL}/demo/modo", data=cuerpo, method="POST"), timeout=5).close()

    def estado(self):
        try:
            with urllib.request.urlopen(f"{HOTEL_URL}/demo/estado", timeout=3) as r:
                hotel = json.load(r)
            web = {"web_ok": True, "modo": hotel["modo"], "ocupadas": hotel["ocupadas"],
                   "total": hotel["total"], "libres": hotel["libres"]}
        except (OSError, ValueError, KeyError):
            web = {"web_ok": False, "modo": "normal", "ocupadas": None, "total": 320, "libres": None}
        try:
            escenario = json.loads(OT_ESTADO.read_text())
        except (OSError, ValueError):
            escenario = {}
        ahora = time.time()
        desde = {e: (ahora - escenario[e]) if e in escenario else None for e in ("corte", "elevador")}
        return {
            "ensayo": False,
            "controles": self.controles,
            **web,
            "ot": resumir_ot(self.valores, desde["corte"], desde["elevador"]),
            "nube": {n: (DIR_ANOMALIAS / f"anomalia_{n}").exists() for n in ("gcp", "aws")},
        }

    def visita(self, sesion, agente):
        """Entrar al lobby cuenta como abrir la página del hotel: es la misma definición de visita de los KPI."""
        pedido = urllib.request.Request(f"{HOTEL_URL}/", headers={"Cookie": f"hotel_session={sesion}", "User-Agent": agente})
        try:
            urllib.request.urlopen(pedido, timeout=5).close()
        except OSError:
            pass

    def reservar(self, tipo, noches, sesion, agente):
        cuerpo = urllib.parse.urlencode({"tipo": tipo, "noches": noches}).encode()
        pedido = urllib.request.Request(f"{HOTEL_URL}/reservar", data=cuerpo, method="POST", headers={
            "Cookie": f"hotel_session={sesion}", "User-Agent": agente,
            "Content-Type": "application/x-www-form-urlencoded"})
        # pagos-lentos tarda hasta 4 s por cobro; hotel-web corta a los 15
        try:
            with urllib.request.urlopen(pedido, timeout=20) as r:
                return interpretar_reserva(r.status, r.read().decode(), tipo, noches)
        except urllib.error.HTTPError as e:
            return interpretar_reserva(e.code, e.read().decode(errors="replace"), tipo, noches)
        except OSError:
            return {"ok": False, "motivo": "caida", "mensaje": "El sistema de reservas no responde."}


def interpretar_reserva(status, pagina, tipo, noches):
    """hotel-web responde HTML: 200 con el código, 502 si falló el cobro, 422 si los datos no sirven."""
    if status == 200:
        codigo = RE_CODIGO.search(pagina)
        if codigo:
            nombre, precio = TIPOS[tipo]
            return {"ok": True, "codigo": html.unescape(codigo.group(1)).strip(), "habitacion": nombre,
                    "noches": noches, "monto": precio * noches}
    if status == 502:
        mensaje = RE_MENSAJE.search(pagina)
        return {"ok": False, "motivo": "pago", "mensaje": html.unescape(mensaje.group(1)).strip() if mensaje
                else "No pudimos procesar tu pago. No se realizó ningún cargo."}
    if status == 422:
        return {"ok": False, "motivo": "datos", "mensaje": "Revisa los datos de tu reserva."}
    return {"ok": False, "motivo": "caida", "mensaje": "El sistema de reservas no responde."}


class FuenteEnsayo:
    """Lo mismo que FuenteReal, en memoria: para ensayar la escena sin afectar la demo ni Zabbix."""

    ensayo = True
    controles = True

    def __init__(self, valores):
        self.valores = valores
        self.reiniciar()

    def reiniciar(self):
        self.modo = "normal"
        self.corte = None
        self.elevador = None
        self.nube = {"gcp": False, "aws": False}
        self.web_ok = True
        self.ocupadas = 236

    def ordenar(self, orden):
        ahora = time.time()
        if orden == "reset":
            self.reiniciar()
        elif orden in MODOS:
            self.modo = orden
        elif orden == "corte":
            self.corte = None if self.corte else ahora
        elif orden == "elevador":
            self.elevador = None if self.elevador else ahora
        elif orden in self.nube:
            self.nube[orden] = not self.nube[orden]
        elif orden == "web":
            self.web_ok = not self.web_ok
        else:
            return False
        return True

    def estado(self):
        ahora = time.time()
        corte = ahora - self.corte if self.corte else None
        elevador = ahora - self.elevador if self.elevador else None
        return {
            "ensayo": True,
            "controles": True,
            "web_ok": self.web_ok,
            "modo": self.modo,
            "ocupadas": self.ocupadas if self.web_ok else None,
            "total": 320,
            "libres": 320 - self.ocupadas if self.web_ok else None,
            "ot": resumir_ot(self.valores, corte, elevador),
            "nube": dict(self.nube),
        }

    def visita(self, sesion, agente):
        pass

    def reservar(self, tipo, noches, sesion, agente):
        if not self.web_ok:
            return {"ok": False, "motivo": "caida", "mensaje": "El sistema de reservas no responde."}
        time.sleep(random.uniform(2, 4) if self.modo == "pagos-lentos" else 0.5)
        if self.modo == "pagos-error" and random.random() < 0.65:
            return {"ok": False, "motivo": "pago", "mensaje": "No pudimos procesar tu pago. No se realizó ningún cargo."}
        self.ocupadas += 1
        nombre, precio = TIPOS[tipo]
        return {"ok": True, "codigo": f"ENSAYO-{random.randint(1000, 9999)}", "habitacion": nombre,
                "noches": noches, "monto": precio * noches}


class Manejador(BaseHTTPRequestHandler):
    fuente = None
    server_version = "HotelPixel"

    def log_message(self, *args):
        pass

    def responder(self, cuerpo, tipo="application/json; charset=utf-8", status=200, cabeceras=()):
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        for nombre, valor in cabeceras:
            self.send_header(nombre, valor)
        self.end_headers()
        self.wfile.write(cuerpo)

    def json(self, datos, status=200, cabeceras=()):
        self.responder(json.dumps(datos).encode(), status=status, cabeceras=cabeceras)

    def sesion(self):
        for parte in self.headers.get("Cookie", "").split(";"):
            nombre, _, valor = parte.strip().partition("=")
            if nombre == "hotel_session" and re.fullmatch(r"[0-9a-f]{32}", valor):
                return valor
        return None

    def do_GET(self):
        ruta = urllib.parse.urlsplit(self.path).path
        if ruta == "/api/estado":
            self.json(self.fuente.estado())
        elif ruta == "/salud":
            self.json({"ok": True})
        else:
            self.estatico(ruta)

    def estatico(self, ruta):
        archivo = (WEB / ruta.lstrip("/")).resolve()
        if ruta == "/":
            archivo = WEB / "index.html"
        if WEB not in archivo.parents or not archivo.is_file():
            self.responder(b"No existe", "text/plain; charset=utf-8", 404)
            return
        tipo = mimetypes.guess_type(archivo.name)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo.endswith("javascript"):
            tipo += "; charset=utf-8"
        self.responder(archivo.read_bytes(), tipo)

    def do_POST(self):
        ruta = urllib.parse.urlsplit(self.path).path
        try:
            datos = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            self.json({"ok": False, "motivo": "datos", "mensaje": "Petición inválida."}, 400)
            return
        agente = self.headers.get("User-Agent", "hotel-pixel")
        if ruta == "/api/entrar":
            sesion = self.sesion() or uuid.uuid4().hex
            self.fuente.visita(sesion, agente)
            self.json({"ok": True}, cabeceras=[("Set-Cookie", f"hotel_session={sesion}; Max-Age=3600; SameSite=Lax; Path=/")])
        elif ruta == "/api/reservar":
            tipo, noches = datos.get("tipo"), datos.get("noches")
            if tipo not in TIPOS or not isinstance(noches, int) or not 1 <= noches <= 30:
                self.json({"ok": False, "motivo": "datos", "mensaje": "Revisa los datos de tu reserva."}, 422)
                return
            sesion = self.sesion() or uuid.uuid4().hex
            self.json(self.fuente.reservar(tipo, noches, sesion, agente))
        elif ruta == "/api/control" and self.fuente.controles:
            try:
                ok = self.fuente.ordenar(datos.get("orden"))
            except OSError as e:
                self.json({"ok": False, "mensaje": str(e)}, 502)
                return
            self.json({"ok": ok}, 200 if ok else 422)
        else:
            self.json({"ok": False}, 404)


def main():
    argumentos = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    argumentos.add_argument("--ensayo", action="store_true", help="estado en memoria, sin tocar la demo real")
    argumentos.add_argument("--controles", action="store_true",
                            help="en la demo real, deja lanzar los actos con el teclado de la escena (o PIXEL_CONTROLES=1)")
    argumentos.add_argument("--puerto", type=int, default=int(os.environ.get("PIXEL_PORT", 8090)))
    opciones = argumentos.parse_args()
    controles = opciones.controles or os.environ.get("PIXEL_CONTROLES") == "1"
    sim = cargar_simulador()
    Manejador.fuente = FuenteEnsayo(sim.valores) if opciones.ensayo else FuenteReal(sim, controles)
    modo = "ensayo" if opciones.ensayo else "demo real, con controles" if controles else "demo real"
    print(f"Hotel pixel en http://0.0.0.0:{opciones.puerto} ({modo})", flush=True)
    ThreadingHTTPServer(("0.0.0.0", opciones.puerto), Manejador).serve_forever()


if __name__ == "__main__":
    main()
