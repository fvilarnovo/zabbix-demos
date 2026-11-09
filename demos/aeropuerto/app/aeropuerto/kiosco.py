"""kiosco: punto de entrada del check-in. Orquesta reservas (que emite con pasajes), equipaje y la tarjeta de embarque."""
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
comun.instrumentar(app, "kiosco")
tracer = trace.get_tracer("aeropuerto.kiosco")

RESERVAS = os.environ.get("RESERVAS_URL", "http://127.0.0.1:8102")
EQUIPAJE = os.environ.get("EQUIPAJE_URL", "http://127.0.0.1:8104")


class CheckIn(BaseModel):
    vuelo: str
    valijas: int = 1
    demorado: bool = False
    canal: str = "kiosco"
    terminal: str = "T1"


@app.get("/salud")
def salud():
    return {"ok": True}


def _fallo(paso, detalle):
    span = trace.get_current_span()
    span.set_status(Status(StatusCode.ERROR, detalle))
    comun.anotar(resultado="error", paso_fallido=paso)
    return JSONResponse(status_code=502, content={
        "ok": False, "paso": paso, "error": detalle, "trace_id": format(span.get_span_context().trace_id, "032x")})


@app.post("/checkin")
def checkin(datos: CheckIn):
    pnr = uuid.uuid4().hex[:6].upper()
    comun.anotar(vuelo=datos.vuelo, pnr=pnr, valijas=datos.valijas, demorado=datos.demorado,
                 canal=datos.canal, terminal=datos.terminal)
    time.sleep(random.uniform(0.01, 0.04))

    reserva = httpx.post(f"{RESERVAS}/validar", json={"pnr": pnr, "vuelo": datos.vuelo}, timeout=12)
    if reserva.status_code != 200:
        return _fallo("pasajes", "No se pudo emitir el pasaje")

    equipaje = httpx.post(f"{EQUIPAJE}/registrar", json={"pnr": pnr, "valijas": datos.valijas}, timeout=8)
    if equipaje.status_code != 200:
        return _fallo("equipaje", "No se pudo registrar el equipaje")

    with tracer.start_as_current_span("emitir tarjeta de embarque") as tarjeta:
        time.sleep(random.uniform(0.02, 0.06))
        asiento = f"{random.randint(4, 34)}{random.choice('ABCDEF')}"
        tarjeta.set_attribute("aeropuerto.asiento", asiento)

    comun.anotar(resultado="ok")
    span = trace.get_current_span()
    return {"ok": True, "pnr": pnr, "asiento": asiento, "vuelo": datos.vuelo,
            "trace_id": format(span.get_span_context().trace_id, "032x")}
