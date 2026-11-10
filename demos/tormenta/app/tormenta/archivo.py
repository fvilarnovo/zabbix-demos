"""archivo: guarda cada imagen entregada."""
import random
import time

from fastapi import FastAPI
from pydantic import BaseModel

from . import comun

app = FastAPI()
comun.instrumentar(app, "archivo")

BD = comun.DATOS / "archivo.db"
comun.consulta(BD, "CREATE TABLE IF NOT EXISTS imagenes (imagen TEXT PRIMARY KEY, zona TEXT, megas REAL, creada REAL)")


class Imagen(BaseModel):
    imagen: str
    zona: str
    megas: float


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/guardar")
def guardar(datos: Imagen):
    time.sleep(random.uniform(0.01, 0.04))
    comun.consulta(BD, "INSERT OR REPLACE INTO imagenes VALUES (?, ?, ?, ?)", (datos.imagen, datos.zona, datos.megas, time.time()))
    comun.anotar(imagen=datos.imagen, zona=datos.zona)
    return {"guardada": True}
