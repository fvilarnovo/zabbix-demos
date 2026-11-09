"""pasajes: emite el pasaje. Es el servicio que falla en el escenario del mostrador."""
import random
import sys
import time
import os
import uuid

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo  # noqa: E402

from . import comun  # noqa: E402

app = FastAPI()
comun.instrumentar(app, "pasajes")

PROBABILIDAD_ERROR = 0.85


class Emision(BaseModel):
    pnr: str
    vuelo: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/emitir")
def emitir(datos: Emision):
    modo = estado_demo.modo_pasajes()
    comun.anotar(vuelo=datos.vuelo, pnr=datos.pnr, modo=modo)
    if modo == "lento":
        time.sleep(random.uniform(2.0, 3.8))
    elif modo == "error":
        time.sleep(random.uniform(0.05, 0.2))
        if random.random() < PROBABILIDAD_ERROR:
            raise HTTPException(503, "Sistema de pasajes bloqueado")
    else:
        time.sleep(random.uniform(0.05, 0.16))
    return {"ticket": uuid.uuid4().hex[:10].upper()}
