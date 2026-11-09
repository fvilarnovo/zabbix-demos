"""reservas: valida el localizador en su base y pide la emisión a pasajes."""
import os
import random
import time

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "reservas")

BD = comun.DATOS / "reservas.db"
PASAJES = os.environ.get("PASAJES_URL", "http://127.0.0.1:8103")

comun.consulta(BD, "CREATE TABLE IF NOT EXISTS reservas (pnr TEXT PRIMARY KEY, vuelo TEXT, creada REAL)")


class Validacion(BaseModel):
    pnr: str
    vuelo: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/validar")
def validar(datos: Validacion):
    time.sleep(random.uniform(0.01, 0.03))
    comun.consulta(BD, "INSERT OR REPLACE INTO reservas VALUES (?, ?, ?)", (datos.pnr, datos.vuelo, time.time()))
    comun.anotar(vuelo=datos.vuelo, pnr=datos.pnr)
    emision = httpx.post(f"{PASAJES}/emitir", json=datos.model_dump(), timeout=10)
    if emision.status_code != 200:
        raise HTTPException(502, "Pasajes no pudo emitir")
    return emision.json()
