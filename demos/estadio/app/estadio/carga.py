"""Generador de carga: hinchas que compran entradas, pasan por los molinetes y compran en la tienda, sin parar.

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

BOLETERIA = os.environ.get("BOLETERIA_URL", "http://127.0.0.1:8201")
ACCESOS = os.environ.get("ACCESOS_URL", "http://127.0.0.1:8202")
TIENDA = os.environ.get("TIENDA_URL", "http://127.0.0.1:8203")
VENTANA_SEG = 45
SECTORES = ("Popular", "Popular", "Preferente", "Preferente", "Platea", "Palco")
PRODUCTOS = ("Camiseta titular", "Camiseta titular", "Camiseta alternativa", "Bufanda", "Gorra", "Balón", "Taza")
# (nombre, período medio en segundos, pedido)
FLUJOS = (
    ("accesos", 1.6, lambda: (f"{ACCESOS}/validar", {"canal": "carga"})),
    ("boleteria", 4.0, lambda: (f"{BOLETERIA}/entrada", {"sector": random.choice(SECTORES), "canal": "carga"})),
    ("tienda", 3.0, lambda: (f"{TIENDA}/compra", {"producto": random.choice(PRODUCTOS), "canal": "carga"})),
)

muestras = collections.deque()
candado = threading.Lock()


def un_pedido(nombre, armar):
    url, cuerpo = armar()
    inicio = time.monotonic()
    try:
        ok = httpx.post(url, json=cuerpo, timeout=15).status_code == 200
    except httpx.HTTPError:
        ok = False
    with candado:
        muestras.append((time.time(), (time.monotonic() - inicio) * 1000, ok, nombre))


def resumen(filas):
    n = len(filas)
    duraciones = sorted(m[1] for m in filas)
    return {
        "n": n,
        "p95_ms": round(duraciones[min(n - 1, int(n * 0.95))]) if n else 0,
        "err_pct": round(sum(not m[2] for m in filas) / n * 100, 1) if n else 0,
    }


def publicar():
    while True:
        limite = time.time() - VENTANA_SEG
        with candado:
            while muestras and muestras[0][0] < limite:
                muestras.popleft()
            actuales = list(muestras)
        datos = resumen(actuales)
        for nombre, _, _ in FLUJOS:
            datos[nombre] = resumen([m for m in actuales if m[3] == nombre])
        estado.escribir(estado.LATENCIA, datos)
        time.sleep(2)


def flujo(nombre, periodo, armar):
    while True:
        threading.Thread(target=un_pedido, args=(nombre, armar), daemon=True).start()
        time.sleep(random.expovariate(1 / periodo))


def main():
    threading.Thread(target=publicar, daemon=True).start()
    for nombre, periodo, armar in FLUJOS[1:]:
        threading.Thread(target=flujo, args=(nombre, periodo, armar), daemon=True).start()
    flujo(*FLUJOS[0])


if __name__ == "__main__":
    main()
