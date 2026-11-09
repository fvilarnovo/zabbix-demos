#!/usr/bin/env python3
"""Simulador OT del hotel: envía todos los recursos por trapper cada 5 s.

  hotel_ot_sim.py correr                     bucle del servicio (contenedor)
  hotel_ot_sim.py escenario corte|elevador   arranca un escenario; pueden convivir (corte primero)
  hotel_ot_sim.py escenario normal           vuelve todo a la normalidad

El escenario "corte" es una línea de tiempo fija: la causa siempre llega primero, porque CEP toma el primer
evento de la ventana como causa. Antes de empezar cierra las ventanas CEP con un evento de control, para que
un corte nuevo no quede como síntoma del anterior. La autonomía y la temperatura corren más rápido que en la realidad, para que
quepan en el escenario.
"""
import json
import math
import pathlib
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from zbx_sender import ZabbixSender  # noqa: E402

HOST = "Hotel Gran Forum - OT"
ESTADO_DIR = os.environ.get("ESTADO_DIR", "/estado")
ESTADO = pathlib.Path(os.environ.get("OT_ESTADO", os.path.join(ESTADO_DIR, "ot_escenario.json")))
TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "zabbix-server")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
INTERVALO = 5
ESPERA_REINICIO = 3


def leer_estado():
    try:
        return json.loads(ESTADO.read_text())
    except (OSError, ValueError):
        return {}


def guardar_estado(estado):
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    temporal = ESTADO.with_suffix(".tmp")
    temporal.write_text(json.dumps(estado))
    temporal.replace(ESTADO)


def valores(corte, elevador, ahora):
    """corte y elevador: segundos desde que arrancó cada escenario, o None."""
    r = random.uniform
    # Ciclo diario suave, para que los clientes Wi-Fi no sean una línea recta
    clientes = 220 + 40 * math.sin(ahora / 86400 * 2 * math.pi)
    v = {
        "hotel.grid.state": 1,
        "hotel.grid.voltage": round(r(125, 129), 1),
        "hotel.ups.on_battery": 0,
        "hotel.ups.battery_pct": 100,
        "hotel.ups.runtime_min": round(r(44, 46), 1),
        "hotel.ups.load_pct": round(r(38, 44), 1),
        "hotel.gen.state": 0,
        "hotel.gen.fuel_pct": 78,
        "hotel.gen.start_battery_v": round(r(12.5, 12.7), 2),
        "hotel.hvac.chiller_state": 1,
        "hotel.hvac.supply_temp": round(r(6.8, 7.4), 1),
        "hotel.hvac.lobby_temp": round(r(22.5, 23.5), 1),
        "hotel.elev.state[1]": 1,
        "hotel.elev.state[2]": 1,
        "hotel.elev.state[3]": 1,
        "hotel.wifi.aps_up": 48,
        "hotel.wifi.clients": int(clientes + r(-10, 10)),
    }
    if corte is not None:
        v["hotel.grid.state"] = 0
        v["hotel.grid.voltage"] = 0
        # Sin batería de arranque suficiente, el generador lo intenta y falla; se ve también en su tensión
        if corte >= 15:
            v["hotel.gen.state"] = 1
            v["hotel.gen.start_battery_v"] = round(r(10.4, 10.8), 2)
        if corte >= 8:
            v["hotel.ups.on_battery"] = 1
            v["hotel.ups.load_pct"] = round(r(68, 74), 1)
            v["hotel.ups.battery_pct"] = round(max(5, 100 - (corte - 8) * 0.5), 1)
            v["hotel.ups.runtime_min"] = round(max(2, 18 - (corte - 8) * 0.1), 1)
        if corte >= 30:
            v["hotel.gen.state"] = 3
        if corte >= 40:
            v["hotel.hvac.chiller_state"] = 0
            v["hotel.hvac.supply_temp"] = round(min(18, 7 + (corte - 40) * 0.1), 1)
            v["hotel.hvac.lobby_temp"] = round(min(31, 23 + (corte - 40) * 0.05), 1)
        if corte >= 55:
            v["hotel.elev.state[2]"] = 0
        if corte >= 65:
            v["hotel.elev.state[3]"] = 0
        if corte >= 75:
            v["hotel.wifi.aps_up"] = 12
            v["hotel.wifi.clients"] = int(v["hotel.wifi.clients"] * 0.2)
    if elevador is not None:
        v["hotel.elev.state[1]"] = 0
    return v


def enviar(v):
    lote = [{"host": HOST, "key": clave, "value": valor} for clave, valor in v.items()]
    ok, info = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT).send_batch(lote)
    if not ok:
        print(f"!! trapper: {info}", flush=True)


def correr():
    while True:
        ahora = time.time()
        estado = leer_estado()
        desde = {e: (ahora - estado[e]) if e in estado else None for e in ("corte", "elevador")}
        enviar(valores(desde["corte"], desde["elevador"], ahora))
        time.sleep(INTERVALO)


def reiniciar_ventanas():
    enviar({"hotel.cep.reinicio": 1})
    time.sleep(ESPERA_REINICIO)
    enviar({"hotel.cep.reinicio": 0})
    time.sleep(ESPERA_REINICIO)


def escenario(nombre):
    if nombre == "normal":
        guardar_estado({})
    elif nombre == "corte":
        reiniciar_ventanas()
        guardar_estado({**leer_estado(), nombre: time.time()})
    elif nombre == "elevador":
        guardar_estado({**leer_estado(), nombre: time.time()})
    else:
        raise SystemExit(f"Escenario desconocido: {nombre}")
    print(f"OK escenario {nombre}")


if __name__ == "__main__":
    if sys.argv[1:] == ["correr"]:
        correr()
    elif len(sys.argv) == 3 and sys.argv[1] == "escenario":
        escenario(sys.argv[2])
    else:
        raise SystemExit(__doc__)
