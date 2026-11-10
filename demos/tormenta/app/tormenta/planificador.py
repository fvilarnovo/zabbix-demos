"""planificador: reserva una ventana de bajada con el satélite. Falla cuando el enlace está degradado por la tormenta."""
import os
import random
import sys
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo  # noqa: E402

from . import comun  # noqa: E402

app = FastAPI()
comun.instrumentar(app, "planificador")

SNR_MINIMO = 6
PROBABILIDAD_ERROR = 0.75


class Plan(BaseModel):
    imagen: str
    zona: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/planificar")
def planificar(datos: Plan):
    # El planificador lee la calidad del enlace que ve la estación terrena: es la misma que recibe Zabbix
    snr = estado_demo.leer(estado_demo.MUNDO, {}).get("estacion", {}).get("snr", 13)
    comun.anotar(imagen=datos.imagen, zona=datos.zona, snr_db=snr)
    if snr < SNR_MINIMO:
        time.sleep(random.uniform(0.6, 1.4))
        if random.random() < PROBABILIDAD_ERROR:
            raise HTTPException(503, f"Enlace degradado (SNR {snr:.1f} dB): no se pudo programar la bajada")
    else:
        time.sleep(random.uniform(0.08, 0.22))
    return {"ventana": "próxima pasada", "snr_db": snr}
