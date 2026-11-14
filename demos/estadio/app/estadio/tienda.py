"""tienda: la tienda oficial de Zabbix FC. Cobra cada venta en la pasarela; sin terminales de cobro no puede vender."""
import os
import random
import sys
import time

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo  # noqa: E402

from . import comun  # noqa: E402

app = FastAPI()
comun.instrumentar(app, "tienda")
tracer = trace.get_tracer("estadio.tienda")

COBROS = os.environ.get("COBROS_URL", "http://127.0.0.1:8204")
BD = comun.DATOS / "tienda.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS ventas (id INTEGER PRIMARY KEY, producto TEXT, precio REAL, creada REAL)")

PRODUCTOS = {"Camiseta titular": 1490, "Camiseta alternativa": 1390, "Bufanda": 420, "Gorra": 380, "Balón": 690, "Taza": 240}
POS_MINIMO = 1
PROBABILIDAD_ERROR = 0.9


class Venta(BaseModel):
    producto: str = "Camiseta titular"
    canal: str = "demo"


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


def _fallo(codigo, paso, detalle):
    trace.get_current_span().set_status(Status(StatusCode.ERROR, detalle))
    comun.anotar(resultado="error", paso_fallido=paso)
    return JSONResponse(status_code=codigo, content={"ok": False, "paso": paso, "error": detalle, "trace_id": _traza()})


@app.post("/compra")
def compra(datos: Venta):
    producto = datos.producto if datos.producto in PRODUCTOS else "Camiseta titular"
    precio = PRODUCTOS[producto]
    pos = estado_demo.leer(estado_demo.MUNDO, {}).get("tienda", {}).get("pos", 6)
    comun.anotar(producto=producto, canal=datos.canal, terminales=pos)
    if pos < POS_MINIMO:
        with tracer.start_as_current_span("esperar terminal de cobro") as espera:
            time.sleep(random.uniform(0.6, 1.3))
            espera.set_status(Status(StatusCode.ERROR, "Sin terminales de cobro"))
        if random.random() < PROBABILIDAD_ERROR:
            return _fallo(503, "terminal", "No hay terminales de cobro en línea")
    time.sleep(random.uniform(0.02, 0.06))
    cobro = httpx.post(f"{COBROS}/cobrar", json={"concepto": producto, "monto": precio}, timeout=8)
    if cobro.status_code != 200:
        return _fallo(502, "cobros", "No se pudo cobrar")
    comun.consulta(BD, "INSERT INTO ventas (producto, precio, creada) VALUES (?, ?, ?)", (producto, precio, time.time()))
    comun.anotar(resultado="ok", monto=precio)
    return {"ok": True, "producto": producto, "precio": precio, "trace_id": _traza()}
