"""habitaciones-api: ocupación del hotel. Cada cambio deja la ocupación en el span (hotel.rooms.occupied)."""
import random
import time

from fastapi import FastAPI, HTTPException

from . import comun

app = FastAPI()
comun.instrumentar(app, "habitaciones-api")

BD = comun.DATOS / "habitaciones.db"
OCUPACION_INICIAL = 236

comun.consulta(BD, "CREATE TABLE IF NOT EXISTS ocupacion (id INTEGER PRIMARY KEY CHECK (id = 1), ocupadas INTEGER)")
comun.consulta(BD, "INSERT OR IGNORE INTO ocupacion VALUES (1, ?)", (OCUPACION_INICIAL,))


def cambiar(delta):
    time.sleep(random.uniform(0.01, 0.05))
    filas = comun.consulta(
        BD, "UPDATE ocupacion SET ocupadas = ocupadas + ? WHERE id = 1 AND ocupadas + ? BETWEEN 0 AND ? RETURNING ocupadas",
        (delta, delta, comun.TOTAL_HABITACIONES))
    if not filas:
        raise HTTPException(409, "Sin cambio de ocupación posible")
    comun.anotar(**{"rooms.occupied": filas[0][0]})
    return {"ocupadas": filas[0][0], "total": comun.TOTAL_HABITACIONES}


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/disponibilidad")
def disponibilidad():
    time.sleep(random.uniform(0.01, 0.04))
    actual = comun.consulta(BD, "SELECT ocupadas FROM ocupacion WHERE id = 1")[0][0]
    return {"ocupadas": actual, "total": comun.TOTAL_HABITACIONES, "libres": comun.TOTAL_HABITACIONES - actual}


@app.post("/checkin")
def checkin():
    return cambiar(+1)


@app.post("/checkout")
def checkout():
    return cambiar(-1)
