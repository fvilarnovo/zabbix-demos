"""peaje-gateway: punto de entrada de la app de recaudo. Lo llaman los controladores de carril de las tres plazas.

Orquesta tarifas, validación del TAG (que consulta al operador de interoperabilidad) y el registro de la transacción.
Si el TAG no se valida, la transacción sigue como pago manual en el mismo carril (más lento): así un problema de APM
se convierte en cola en la vía.
"""
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
from .comun import estado_demo

app = FastAPI()
comun.instrumentar(app, "peaje-gateway")
tracer = trace.get_tracer("autopista.gateway")


class Transaccion(BaseModel):
    plaza: str
    carril: str
    sentido: str = "A"
    categoria: int = 1
    medio: str = "efectivo"
    tag_id: str = ""
    placa: str = ""
    contingencia: bool = False


@app.get("/salud")
def salud():
    return {"ok": True}


def _fallo(paso, detalle, codigo=503):
    span = trace.get_current_span()
    span.set_status(Status(StatusCode.ERROR, detalle))
    comun.anotar(resultado="error", paso_fallido=paso)
    return JSONResponse(status_code=codigo, content={"ok": False, "paso": paso, "error": detalle, "trace_id": comun.trace_id()})


@app.post("/v1/transacciones")
def transaccion(t: Transaccion):
    heap, reiniciando = comun.heap_gateway(estado_demo.edad("gateway-memoria"))
    comun.anotar(plaza=t.plaza, carril=t.carril, sentido=t.sentido, categoria=t.categoria, placa=t.placa,
                 medio_solicitado=t.medio, contingencia=t.contingencia, heap_pct=round(heap, 1))
    if reiniciando:
        time.sleep(random.uniform(0.2, 0.6))
        return _fallo("gateway", "Gateway reiniciando (OutOfMemoryError)")
    # GC: con el heap alto las pausas crecen
    time.sleep(random.uniform(0.004, 0.015) + 0.0022 * max(0.0, heap - 70) ** 2)

    r = httpx.get(f"{comun.TARIFAS}/tarifa", params={"plaza": t.plaza, "categoria": t.categoria}, timeout=5)
    if r.status_code != 200:
        return _fallo("tarifas", "Sin tarifa vigente")
    valor = r.json()["valor"]

    medio, rechazado = t.medio, False
    if t.medio == "tag":
        try:
            v = httpx.post(f"{comun.VALIDACION}/validar", json={"tag_id": t.tag_id, "plaza": t.plaza}, timeout=6)
            if v.status_code != 200:
                medio, rechazado = "efectivo", True
        except httpx.HTTPError:
            medio, rechazado = "efectivo", True

    reg = httpx.post(f"{comun.TRANSACCIONES}/registrar", timeout=10, json={
        "id": uuid.uuid4().hex[:12], "plaza": t.plaza, "carril": t.carril, "sentido": t.sentido, "categoria": t.categoria,
        "medio": medio, "valor": valor, "placa": t.placa, "contingencia": t.contingencia})
    if reg.status_code != 200:
        return _fallo("registro", "No se pudo registrar la transacción")

    comun.anotar(medio=medio, valor=valor, tag_rechazado=rechazado, resultado="ok")
    return {"ok": True, "valor": valor, "medio": medio, "tag_rechazado": rechazado, "trace_id": comun.trace_id()}
