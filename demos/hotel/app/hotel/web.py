"""hotel-web: el sitio del hotel y el panel de la demo.

Los KPI de negocio salen de los atributos de estos spans (ver zabbix/crear_kpis_hotel.py):
  GET /           hotel.session_id    -> visitas
  POST /reservar  hotel.amount        -> reservas e ingresos
"""
import os
import pathlib
import uuid

import httpx
from fastapi import Cookie, FastAPI, Form, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import comun

app = FastAPI()
comun.instrumentar(app, "hotel-web")

plantillas = Jinja2Templates(directory=pathlib.Path(__file__).parent / "plantillas")
RESERVAS = os.environ.get("RESERVAS_URL", "http://reservas-api:8000")
HABITACIONES = os.environ.get("HABITACIONES_URL", "http://habitaciones-api:8000")
PAGOS = os.environ.get("PAGOS_URL", "http://pagos-api:8000")

TIPOS = {
    "estandar": {"nombre": "Estándar", "precio": 2400, "detalle": "Vista a la ciudad, cama king, 32 m²"},
    "superior": {"nombre": "Superior", "precio": 3600, "detalle": "Balcón, sala de estar, 45 m²"},
    "suite": {"nombre": "Suite Forum", "precio": 7200, "detalle": "Terraza privada, dos ambientes, 80 m²"},
}


def sesion(hotel_session):
    return hotel_session or uuid.uuid4().hex


def con_sesion(respuesta, session_id):
    respuesta.set_cookie("hotel_session", session_id, max_age=3600, samesite="lax")
    return respuesta


@app.get("/salud")
def salud():
    return {"ok": True}


@app.get("/")
def inicio(request: Request, hotel_session: str | None = Cookie(default=None)):
    session_id = sesion(hotel_session)
    comun.anotar(session_id=session_id)
    return con_sesion(plantillas.TemplateResponse(request, "inicio.html", {"tipos": TIPOS}), session_id)


@app.get("/habitaciones")
def habitaciones(hotel_session: str | None = Cookie(default=None)):
    comun.anotar(session_id=sesion(hotel_session))
    httpx.get(f"{RESERVAS}/tarifas", timeout=10)
    return httpx.get(f"{HABITACIONES}/disponibilidad", timeout=10).json()


@app.post("/reservar")
def reservar(request: Request, tipo: str = Form(...), noches: int = Form(...),
             hotel_session: str | None = Cookie(default=None)):
    session_id = sesion(hotel_session)
    habitacion = TIPOS.get(tipo)
    if habitacion is None or not 1 <= noches <= 30:
        return plantillas.TemplateResponse(request, "error.html", {"mensaje": "Revisa los datos de tu reserva."},
                                           status_code=422)
    monto = habitacion["precio"] * noches
    comun.anotar(session_id=session_id, room_type=tipo, nights=noches, amount=monto)

    r = httpx.post(f"{RESERVAS}/reservas", json={"tipo": tipo, "noches": noches, "monto": monto}, timeout=15)
    if r.status_code != 200:
        # 502 para que el span quede en error: es una venta perdida, no un dato inválido
        return plantillas.TemplateResponse(
            request, "error.html",
            {"mensaje": "No pudimos procesar tu pago. No se realizó ningún cargo."}, status_code=502)
    return plantillas.TemplateResponse(request, "confirmacion.html", {
        "codigo": r.json()["codigo"], "habitacion": habitacion, "noches": noches, "monto": monto})


@app.post("/consumos")
def consumos(monto: float = Form(...)):
    """Cargos a la habitación (restaurante, spa): dan tráfico constante a la pasarela de pagos."""
    r = httpx.post(f"{PAGOS}/charge", json={"monto": monto, "concepto": "consumo"}, timeout=15)
    return JSONResponse({"autorizado": r.status_code == 200}, status_code=200 if r.status_code == 200 else 502)


@app.post("/checkin")
def checkin():
    r = httpx.post(f"{HABITACIONES}/checkin", timeout=10)
    return JSONResponse(r.json(), status_code=r.status_code)


@app.post("/checkout")
def checkout():
    r = httpx.post(f"{HABITACIONES}/checkout", timeout=10)
    return JSONResponse(r.json(), status_code=r.status_code)


@app.get("/demo")
def demo(request: Request):
    return plantillas.TemplateResponse(request, "demo.html", {"modos": comun.MODOS, "actual": comun.modo()})


@app.get("/demo/estado")
def demo_estado():
    return {"modo": comun.modo(), **httpx.get(f"{HABITACIONES}/disponibilidad", timeout=10).json()}


@app.post("/demo/modo")
def demo_modo(modo: str = Form(...)):
    if modo not in comun.MODOS:
        return Response(status_code=422)
    comun.fijar_modo(modo)
    return RedirectResponse("/demo", status_code=303)
