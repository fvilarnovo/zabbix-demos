"""boleteria: vende entradas y responde a los molinetes si una entrada es válida. Falla cuando su base no responde."""
import os
import random
import sys
import time
import uuid

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from pydantic import BaseModel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import estado_demo  # noqa: E402

from . import comun  # noqa: E402

app = FastAPI()
comun.instrumentar(app, "boleteria")
tracer = trace.get_tracer("estadio.boleteria")

COBROS = os.environ.get("COBROS_URL", "http://127.0.0.1:8204")
BD = comun.DATOS / "entradas.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS entradas (codigo TEXT PRIMARY KEY, sector TEXT, precio REAL, creada REAL)")

PRECIOS = {"Popular": 380, "Preferente": 720, "Platea": 1250, "Palco": 2900}
PROBABILIDAD_ERROR = 0.85


class Compra(BaseModel):
    sector: str = "Preferente"
    canal: str = "demo"


class Consulta(BaseModel):
    codigo: str


@app.get("/salud")
def salud():
    return {"ok": True}


def _traza():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


def base_disponible():
    """La base de entradas es la misma que ve Zabbix: si el simulador la da por caída, las consultas se cuelgan y fallan."""
    if estado_demo.leer(estado_demo.MUNDO, {}).get("boleteria", {}).get("bd", True):
        return True
    with tracer.start_as_current_span("esperar a la base de entradas") as espera:
        time.sleep(random.uniform(0.7, 1.5))
        espera.set_status(Status(StatusCode.ERROR, "Sin respuesta de la base de entradas"))
    return random.random() > PROBABILIDAD_ERROR


@app.post("/entrada")
def entrada(datos: Compra):
    sector = datos.sector if datos.sector in PRECIOS else "Preferente"
    precio = PRECIOS[sector]
    codigo = f"ZFC-{uuid.uuid4().hex[:6].upper()}"
    comun.anotar(sector=sector, canal=datos.canal, entrada=codigo)
    if not base_disponible():
        trace.get_current_span().set_status(Status(StatusCode.ERROR, "Base de entradas sin respuesta"))
        comun.anotar(resultado="error", paso_fallido="base de entradas")
        return JSONResponse(status_code=503, content={"ok": False, "paso": "boleteria", "error": "La base de entradas no responde", "trace_id": _traza()})
    cobro = httpx.post(f"{COBROS}/cobrar", json={"concepto": f"entrada {sector}", "monto": precio}, timeout=8)
    if cobro.status_code != 200:
        trace.get_current_span().set_status(Status(StatusCode.ERROR, "Cobro rechazado"))
        return JSONResponse(status_code=502, content={"ok": False, "paso": "cobros", "error": "No se pudo cobrar", "trace_id": _traza()})
    comun.consulta(BD, "INSERT OR REPLACE INTO entradas VALUES (?, ?, ?, ?)", (codigo, sector, precio, time.time()))
    comun.anotar(resultado="ok", monto=precio)
    return {"ok": True, "entrada": codigo, "sector": sector, "precio": precio, "trace_id": _traza()}


@app.post("/consultar")
def consultar(datos: Consulta):
    comun.anotar(entrada=datos.codigo)
    if not base_disponible():
        raise HTTPException(503, "La base de entradas no responde")
    time.sleep(random.uniform(0.01, 0.04))
    filas = comun.consulta(BD, "SELECT sector FROM entradas WHERE codigo = ?", (datos.codigo,))
    # Los abonos de temporada no pasan por la venta del día: se aceptan igual
    return {"valida": True, "sector": filas[0][0] if filas else "Abono"}
