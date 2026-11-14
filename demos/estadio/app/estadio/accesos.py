"""accesos: el molinete. Valida cada entrada contra la boletería antes de dejar pasar."""
import os
import random
import time
import uuid

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "accesos")

BOLETERIA = os.environ.get("BOLETERIA_URL", "http://127.0.0.1:8201")
PUERTAS = ("Norte", "Sur", "Este", "Oeste")


class Pase(BaseModel):
    codigo: str = ""
    puerta: str = ""
    canal: str = "demo"


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


@app.post("/validar")
def validar(datos: Pase):
    codigo = datos.codigo or f"ABO-{uuid.uuid4().hex[:6].upper()}"
    puerta = datos.puerta if datos.puerta in PUERTAS else random.choice(PUERTAS)
    comun.anotar(entrada=codigo, puerta=puerta, canal=datos.canal)
    time.sleep(random.uniform(0.01, 0.03))
    try:
        respuesta = httpx.post(f"{BOLETERIA}/consultar", json={"codigo": codigo}, timeout=8)
        ok = respuesta.status_code == 200
    except httpx.HTTPError:
        ok = False
    if not ok:
        trace.get_current_span().set_status(Status(StatusCode.ERROR, "No se pudo validar la entrada"))
        comun.anotar(resultado="rechazado", paso_fallido="boleteria")
        return JSONResponse(status_code=502, content={"ok": False, "paso": "boleteria", "puerta": puerta,
                                                      "error": "El molinete no pudo validar la entrada", "trace_id": _traza()})
    comun.anotar(resultado="ok", sector=respuesta.json()["sector"])
    return {"ok": True, "entrada": codigo, "puerta": puerta, "sector": respuesta.json()["sector"], "trace_id": _traza()}
