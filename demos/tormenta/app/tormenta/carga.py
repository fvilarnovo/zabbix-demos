"""Generador de carga: pedidos de imágenes continuos contra la estación y medición real de latencia y errores.

Publica en $ESTADO_DIR/latencia.json el p95 y el porcentaje de errores de los últimos 45 s, para el check y la escena.
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

ESTACION = os.environ.get("ESTACION_URL", "http://127.0.0.1:8201")
VENTANA_SEG = 45
PERIODO_SEG = 2.5
ZONAS = ("Golfo de México", "Península de Yucatán", "Valle de México", "Sierra Madre", "Costa de Veracruz", "Bajío", "Baja California")

muestras = collections.deque()
candado = threading.Lock()


def un_pedido():
    inicio = time.monotonic()
    try:
        ok = httpx.post(f"{ESTACION}/imagen", json={"zona": random.choice(ZONAS), "canal": "carga"}, timeout=15).status_code == 200
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
        threading.Thread(target=un_pedido, daemon=True).start()
        time.sleep(random.expovariate(1 / PERIODO_SEG))


if __name__ == "__main__":
    main()
