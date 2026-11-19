"""transacciones: registra cada paso por el peaje en la base de recaudo. En su escenario la base tiene bloqueos."""
import random
import threading
import time

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from . import comun
from .comun import estado_demo

app = FastAPI()
comun.instrumentar(app, "transacciones")
BD = comun.DATOS / "recaudo.db"
comun.consulta(BD, """CREATE TABLE IF NOT EXISTS transacciones (
    id TEXT PRIMARY KEY, ts REAL, plaza TEXT, carril TEXT, sentido TEXT, categoria INTEGER,
    medio TEXT, valor INTEGER, placa TEXT, contingencia INTEGER)""")
escritas = {"n": 0}
candado = threading.Lock()


class Registro(BaseModel):
    id: str
    plaza: str
    carril: str
    sentido: str
    categoria: int
    medio: str
    valor: int
    placa: str = ""
    contingencia: bool = False


@app.get("/salud")
def salud():
    return {"ok": True}


@app.post("/registrar")
def registrar(r: Registro):
    comun.anotar(plaza=r.plaza, carril=r.carril, medio=r.medio, valor=r.valor, contingencia=r.contingencia)
    if estado_demo.edad("bd-recaudo") is not None:
        # sesiones bloqueadas: la sentencia espera el lock y a veces vence
        time.sleep(random.uniform(1.2, 3.6))
        if random.random() < 0.3:
            comun.anotar(resultado="lock_timeout")
            raise HTTPException(503, "Tiempo de espera de bloqueo agotado en la base de recaudo")
    comun.consulta(BD, "SELECT COUNT(*) FROM transacciones WHERE placa = ? AND ts > ?", (r.placa, time.time() - 60))
    comun.consulta(BD, "INSERT OR REPLACE INTO transacciones VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (r.id, time.time(), r.plaza, r.carril, r.sentido, r.categoria, r.medio, r.valor, r.placa, int(r.contingencia)))
    with candado:
        escritas["n"] += 1
        purgar = escritas["n"] % 2000 == 0
    if purgar:
        comun.consulta(BD, "DELETE FROM transacciones WHERE ts < ?", (time.time() - 3 * 86400,))
    comun.anotar(resultado="ok")
    return {"ok": True}
