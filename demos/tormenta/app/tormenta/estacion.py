"""estacion: punto de entrada de un pedido de imagen. Pide la ventana de bajada al planificador y guarda la imagen en el archivo."""
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
comun.instrumentar(app, "estacion")
tracer = trace.get_tracer("tormenta.estacion")

PLANIFICADOR = os.environ.get("PLANIFICADOR_URL", "http://127.0.0.1:8202")
ARCHIVO = os.environ.get("ARCHIVO_URL", "http://127.0.0.1:8203")


class Pedido(BaseModel):
    zona: str = "Golfo de México"
    canal: str = "demo"


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


def _fallo(paso, detalle):
    span = trace.get_current_span()
    span.set_status(Status(StatusCode.ERROR, detalle))
    comun.anotar(resultado="error", paso_fallido=paso)
    return JSONResponse(status_code=502, content={"ok": False, "paso": paso, "error": detalle, "trace_id": _traza()})


@app.post("/imagen")
def imagen(pedido: Pedido):
    codigo = f"IMG-{uuid.uuid4().hex[:6].upper()}"
    comun.anotar(zona=pedido.zona, imagen=codigo, canal=pedido.canal, satelite="ZABBIXSAT-1")
    time.sleep(random.uniform(0.01, 0.03))

    plan = httpx.post(f"{PLANIFICADOR}/planificar", json={"imagen": codigo, "zona": pedido.zona}, timeout=12)
    if plan.status_code != 200:
        return _fallo("planificador", plan.json().get("detail", "No se pudo programar la bajada"))

    with tracer.start_as_current_span("bajar imagen del satélite") as bajada:
        time.sleep(random.uniform(0.05, 0.12))
        megas = round(random.uniform(180, 420), 1)
        bajada.set_attribute("tormenta.megabytes", megas)

    guardado = httpx.post(f"{ARCHIVO}/guardar", json={"imagen": codigo, "zona": pedido.zona, "megas": megas}, timeout=8)
    if guardado.status_code != 200:
        return _fallo("archivo", "No se pudo guardar la imagen")

    comun.anotar(resultado="ok", megabytes=megas)
    return {"ok": True, "imagen": codigo, "zona": pedido.zona, "megas": megas, "trace_id": _traza()}
