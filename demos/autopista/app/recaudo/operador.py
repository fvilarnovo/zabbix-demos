"""operador-tag: simula al operador externo de interoperabilidad TAG (IP/REV). En su escenario deja de responder."""
import random
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import comun
from .comun import estado_demo

app = FastAPI()
comun.instrumentar(app, "operador-tag")


class Autorizacion(BaseModel):
    tag_id: str
    plaza: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/autorizar")
def autorizar(a: Autorizacion):
    comun.anotar(tag_id=a.tag_id, plaza=a.plaza)
    if estado_demo.edad("operador-tag") is not None:
        # el enlace con el operador queda colgado: el cliente corta por timeout a los 3 s
        time.sleep(random.uniform(3.4, 5.0))
        raise HTTPException(503, "Operador TAG sin respuesta")
    time.sleep(random.uniform(0.04, 0.12))
    if random.random() < 0.006:
        raise HTTPException(402, "Saldo insuficiente")
    return {"autorizado": True}
