"""tarifas: tarifa vigente por plaza y categoría (tarifas publicadas por la concesión)."""
import random
import time

from fastapi import FastAPI, HTTPException

from . import comun
from .comun import estado_demo

app = FastAPI()
comun.instrumentar(app, "tarifas")
TARIFAS = {p["id"]: p["tarifas"] for p in estado_demo.corredor()["plazas"]}


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/tarifa")
def tarifa(plaza: str, categoria: int):
    time.sleep(random.uniform(0.002, 0.008))
    valor = TARIFAS.get(plaza, {}).get(str(categoria))
    if valor is None:
        raise HTTPException(404, "Sin tarifa")
    comun.anotar(plaza=plaza, categoria=categoria, valor=valor)
    return {"valor": valor}
