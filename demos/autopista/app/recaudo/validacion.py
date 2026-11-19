"""validacion-tag: valida el TAG contra la lista local y pide autorización al operador de interoperabilidad."""
import random
import time

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "validacion-tag")
LISTAS = comun.DATOS / "listas.db"
comun.consulta(LISTAS, "CREATE TABLE IF NOT EXISTS lista_negra (tag_id TEXT PRIMARY KEY, motivo TEXT)")


class Validacion(BaseModel):
    tag_id: str
    plaza: str


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/validar")
def validar(v: Validacion):
    comun.anotar(tag_id=v.tag_id, plaza=v.plaza)
    time.sleep(random.uniform(0.003, 0.01))
    if comun.consulta(LISTAS, "SELECT motivo FROM lista_negra WHERE tag_id = ?", (v.tag_id,)):
        raise HTTPException(403, "TAG en lista negra")
    try:
        r = httpx.post(f"{comun.OPERADOR}/autorizar", json={"tag_id": v.tag_id, "plaza": v.plaza}, timeout=3)
    except httpx.TimeoutException:
        comun.anotar(resultado="timeout_operador")
        raise HTTPException(504, "El operador TAG no respondió a tiempo")
    if r.status_code != 200:
        comun.anotar(resultado="rechazado")
        raise HTTPException(402 if r.status_code == 402 else 502, "Operador TAG rechazó la autorización")
    comun.anotar(resultado="autorizado")
    return {"autorizado": True}
