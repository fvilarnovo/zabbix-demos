"""Generador de carga: visitantes, reservas, consumos y movimiento de habitaciones.

Los ritmos dependen del modo elegido en el panel /demo. Con 'pagos-error' y 'pagos-lentos' sube el intento de
reserva, para que en el escenario se vean ventas perdidas en pocos minutos y no en media hora.
"""
import os
import random
import threading
import time

import httpx

WEB = os.environ.get("WEB_URL", "http://hotel-web:8000")
TIPOS = ("estandar", "estandar", "estandar", "superior", "superior", "suite")

# modo: (segundos entre visitantes, probabilidad de reservar)
RITMOS = {
    "normal": (10, 0.03),
    "promo": (2, 0.08),
    "pagos-lentos": (6, 0.25),
    "pagos-error": (6, 0.25),
}
SEGUNDOS_ENTRE_CONSUMOS = 6
SEGUNDOS_ENTRE_MOVIMIENTOS = 150
OCUPACION_MIN, OCUPACION_MAX = 0.65, 0.90


def estado():
    try:
        return httpx.get(f"{WEB}/demo/estado", timeout=5).json()
    except (httpx.HTTPError, ValueError):
        return {"modo": "normal", "ocupadas": 236, "total": 320}


def visitante(prob_reserva):
    try:
        with httpx.Client(base_url=WEB, timeout=20) as c:
            c.get("/")
            time.sleep(random.uniform(1, 4))
            if random.random() < 0.6:
                c.get("/habitaciones")
                time.sleep(random.uniform(1, 4))
            if random.random() < prob_reserva:
                c.post("/reservar", data={"tipo": random.choice(TIPOS), "noches": random.randint(1, 5)})
    except httpx.HTTPError:
        pass


def bucle_visitantes():
    while True:
        intervalo, prob = RITMOS.get(estado()["modo"], RITMOS["normal"])
        threading.Thread(target=visitante, args=(prob,), daemon=True).start()
        time.sleep(random.expovariate(1 / intervalo))


def bucle_consumos():
    while True:
        try:
            httpx.post(f"{WEB}/consumos", data={"monto": random.choice((180, 320, 450, 900, 1500))}, timeout=20)
        except httpx.HTTPError:
            pass
        time.sleep(random.expovariate(1 / SEGUNDOS_ENTRE_CONSUMOS))


def bucle_movimientos():
    """Check-ins y check-outs al azar, dentro de una banda para que la ocupación no se vaya a un extremo."""
    while True:
        e = estado()
        ocupacion = e["ocupadas"] / e["total"]
        ruta = random.choice(("/checkin", "/checkout"))
        if ocupacion >= OCUPACION_MAX:
            ruta = "/checkout"
        elif ocupacion <= OCUPACION_MIN:
            ruta = "/checkin"
        try:
            httpx.post(f"{WEB}{ruta}", timeout=10)
        except httpx.HTTPError:
            pass
        time.sleep(random.expovariate(1 / SEGUNDOS_ENTRE_MOVIMIENTOS))


def main():
    threading.Thread(target=bucle_consumos, daemon=True).start()
    threading.Thread(target=bucle_movimientos, daemon=True).start()
    bucle_visitantes()


if __name__ == "__main__":
    main()
