"""Generador de carga: check-ins continuos contra el kiosco y medición real de latencia y errores.

Publica en $ESTADO_DIR/latencia.json el p95 y el porcentaje de errores de los últimos 45 s: el simulador los usa para
decidir cuánto avanza la cola, así la cola responde a lo que realmente pasa en los servicios.
"""
import collections
import os
import random
import sys
import threading
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo as estado  # noqa: E402

KIOSCO = os.environ.get("KIOSCO_URL", "http://127.0.0.1:8101")
VENTANA_SEG = 45
VUELOS = [f"ZB{n}" for n in (410, 417, 424, 431, 438, 445, 452, 459)]

muestras = collections.deque()
candado = threading.Lock()


def un_checkin():
    mundo = estado.leer(estado.MUNDO, {})
    demorados = mundo.get("kpi", {}).get("vuelos_demorados", 0)
    indice = random.randrange(len(VUELOS))
    inicio = time.monotonic()
    try:
        r = httpx.post(f"{KIOSCO}/checkin", timeout=15, json={
            "vuelo": VUELOS[indice], "valijas": random.choice((0, 1, 1, 1, 2)), "demorado": indice < demorados, "canal": "carga"})
        ok = r.status_code == 200
    except httpx.HTTPError:
        ok = False
    with candado:
        muestras.append((time.time(), (time.monotonic() - inicio) * 1000, ok))


def publicar():
    while True:
        limite = time.time() - VENTANA_SEG
        with candado:
            while muestras and muestras[0][0] < limite:
                muestras.popleft()
            actuales = list(muestras)
        n = len(actuales)
        duraciones = sorted(m[1] for m in actuales)
        estado.escribir(estado.LATENCIA, {
            "n": n,
            "p95_ms": round(duraciones[min(n - 1, int(n * 0.95))]) if n else 0,
            "err_pct": round(sum(not m[2] for m in actuales) / n * 100, 1) if n else 0,
        })
        time.sleep(2)


def main():
    threading.Thread(target=publicar, daemon=True).start()
    while True:
        activos = estado.escenarios()["activos"]
        periodo = 0.55 if "pico" in activos else 1.3
        threading.Thread(target=un_checkin, daemon=True).start()
        time.sleep(random.expovariate(1 / periodo))


if __name__ == "__main__":
    main()
