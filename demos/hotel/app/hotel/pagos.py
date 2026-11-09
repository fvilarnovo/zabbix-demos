"""pagos-api: pasarela de pagos simulada. Aquí se inyectan las fallas del acto 1."""
import random
import time

from fastapi import FastAPI, HTTPException
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "pagos-api")


class PasarelaNoDisponible(Exception):
    pass


class Cargo(BaseModel):
    monto: float
    concepto: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/charge")
def cobrar(cargo: Cargo):
    modo = comun.modo()
    comun.anotar(amount=cargo.monto, concepto=cargo.concepto)
    if modo == "pagos-lentos":
        time.sleep(random.uniform(2.0, 4.0))
    else:
        time.sleep(random.uniform(0.15, 0.4))
    if modo == "pagos-error" and random.random() < 0.65:
        # Queda como evento en el span para que el módulo APM agrupe el error por tipo
        error = PasarelaNoDisponible("La pasarela de pagos no respondió")
        span = trace.get_current_span()
        span.record_exception(error)
        span.set_status(Status(StatusCode.ERROR, str(error)))
        raise HTTPException(503, str(error))
    return {"autorizado": True}
