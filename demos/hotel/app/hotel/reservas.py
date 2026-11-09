"""reservas-api: comprueba disponibilidad, cobra y guarda la reserva."""
import os
import random
import time
import uuid

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "reservas-api")

BD = comun.DATOS / "reservas.db"
HABITACIONES = os.environ.get("HABITACIONES_URL", "http://habitaciones-api:8000")
PAGOS = os.environ.get("PAGOS_URL", "http://pagos-api:8000")

comun.consulta(BD, "CREATE TABLE IF NOT EXISTS reservas (codigo TEXT PRIMARY KEY, tipo TEXT, noches INTEGER, monto REAL)")


class Reserva(BaseModel):
    tipo: str
    noches: int
    monto: float


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/tarifas")
def tarifas():
    time.sleep(random.uniform(0.01, 0.03))
    return {"vigentes": comun.consulta(BD, "SELECT count(*) FROM reservas")[0][0] >= 0}


@app.post("/reservas")
def crear(reserva: Reserva):
    disponibilidad = httpx.get(f"{HABITACIONES}/disponibilidad", timeout=10).json()
    if disponibilidad["libres"] <= 0:
        raise HTTPException(409, "Sin habitaciones libres")

    pago = httpx.post(f"{PAGOS}/charge", json={"monto": reserva.monto, "concepto": "reserva"}, timeout=10)
    if pago.status_code != 200:
        raise HTTPException(502, "El pago no se pudo procesar")

    time.sleep(random.uniform(0.01, 0.03))
    codigo = uuid.uuid4().hex[:8].upper()
    comun.consulta(BD, "INSERT INTO reservas VALUES (?, ?, ?, ?)", (codigo, reserva.tipo, reserva.noches, reserva.monto))
    return {"codigo": codigo}
