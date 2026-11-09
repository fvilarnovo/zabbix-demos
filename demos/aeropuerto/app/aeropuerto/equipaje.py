"""equipaje: registra las valijas del pasajero."""
import random
import time

from fastapi import FastAPI
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "equipaje")

BD = comun.DATOS / "equipaje.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS valijas (pnr TEXT, cantidad INTEGER, creada REAL)")


class Registro(BaseModel):
    pnr: str
    valijas: int


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/registrar")
def registrar(datos: Registro):
    time.sleep(random.uniform(0.01, 0.05))
    comun.consulta(BD, "INSERT INTO valijas VALUES (?, ?, ?)", (datos.pnr, datos.valijas, time.time()))
    comun.anotar(pnr=datos.pnr, valijas=datos.valijas)
    return {"etiquetas": datos.valijas}
