#!/usr/bin/env python3
"""Supervisor del contenedor de la demo del hotel: provisiona Zabbix y lanza todos los procesos.

Orden de arranque:
  1. provision/provisionar.py (si PROVISION=1): deja templates, hosts, dashboards y reglas CEP en Zabbix.
  2. Los procesos de la tabla PROCESOS, en paralelo, todos en localhost dentro del contenedor:
     reservas-api :8001, habitaciones-api :8002, pagos-api :8003, hotel-web :8000 (publicado),
     carga, sim-ot, sim-finops, pixel :8090 (publicado) y control :8091 (publicado).
Si un proceso muere, se relanza a los 3 s. Los logs salen por stdout con el nombre del proceso como prefijo.
SIGTERM termina todo ordenadamente.
"""
import os
import pathlib
import signal
import subprocess
import sys
import threading
import time

SRV = pathlib.Path(__file__).resolve().parent
ESTADO = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado"))
REINICIO_SEG = 3
PY = sys.executable

procesos = {}
terminando = False


def log(nombre, texto):
    print(f"[{nombre}] {texto}", flush=True)


def entorno_base():
    e = dict(os.environ)
    e.setdefault("ESTADO_DIR", str(ESTADO))
    e.setdefault("HOTEL_DATOS", str(ESTADO / "datos"))
    e.setdefault("OT_ESTADO", str(ESTADO / "ot_escenario.json"))
    e.setdefault("DIR_ANOMALIAS", str(ESTADO / "finops"))
    e.setdefault("PYTHONUNBUFFERED", "1")
    # servicios del hotel, todos en localhost
    e.setdefault("RESERVAS_URL", "http://127.0.0.1:8001")
    e.setdefault("HABITACIONES_URL", "http://127.0.0.1:8002")
    e.setdefault("PAGOS_URL", "http://127.0.0.1:8003")
    e.setdefault("WEB_URL", "http://127.0.0.1:8000")
    e.setdefault("HOTEL_URL", "http://127.0.0.1:8000")
    e.setdefault("PIXEL_URL", "http://127.0.0.1:8090")
    e.setdefault("SIM_OT", str(SRV / "sim/ot/hotel_ot_sim.py"))
    e.setdefault("SIM_ANOMALIA", str(SRV / "sim/finops/anomalia.py"))
    e.setdefault("OT_SIM", str(SRV / "sim/ot/hotel_ot_sim.py"))
    return e


def uvicorn(modulo, puerto, host="127.0.0.1"):
    return [PY, "-m", "uvicorn", f"hotel.{modulo}:app", "--host", host, "--port", str(puerto), "--no-access-log"]


def tabla_procesos(env):
    app = SRV / "app"
    pixel = [PY, "-u", str(SRV / "pixel/servidor.py"), "--puerto", "8090"]
    if env.get("PIXEL_CONTROLES", "1") == "1":
        pixel.append("--controles")
    historia = env.get("FINOPS_HISTORIA_DIAS", "7")
    return [
        ("reservas-api", uvicorn("reservas", 8001), app),
        ("habitaciones-api", uvicorn("habitaciones", 8002), app),
        ("pagos-api", uvicorn("pagos", 8003), app),
        ("hotel-web", uvicorn("web", 8000, "0.0.0.0"), app),
        ("carga", [PY, "-m", "hotel.carga"], app),
        ("sim-ot", [PY, "-u", str(SRV / "sim/ot/hotel_ot_sim.py"), "correr"], SRV),
        ("sim-finops", [PY, "-u", str(SRV / "sim/finops/finops_simulator.py"), "--historia-si-falta", historia,
                        "--vivo", "--intervalo", env.get("FINOPS_INTERVALO", "10")], SRV),
        ("pixel", pixel, SRV),
        ("control", [PY, "-u", str(SRV / "control/control.py")], SRV),
    ]


def provisionar(env):
    if env.get("PROVISION", "1") != "1":
        log("provision", "PROVISION no es 1: se omite")
        return
    if not env.get("ZABBIX_URL") or not env.get("ZABBIX_API_TOKEN"):
        log("provision", "!! faltan ZABBIX_URL o ZABBIX_API_TOKEN: se omite el provisioning")
        return
    log("provision", "iniciando provisioning de Zabbix")
    r = subprocess.run([PY, "-u", str(SRV / "provision/provisionar.py")], env=env, cwd=SRV / "provision")
    log("provision", "terminado bien" if r.returncode == 0 else f"!! terminó con código {r.returncode}; la demo arranca igual")


def volcar(nombre, salida):
    for linea in iter(salida.readline, b""):
        log(nombre, linea.decode(errors="replace").rstrip())


def lanzar(nombre, cmd, cwd, env):
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    threading.Thread(target=volcar, args=(nombre, p.stdout), daemon=True).start()
    procesos[nombre] = p
    log("supervisor", f"{nombre} iniciado (pid {p.pid})")
    return p


def terminar(*_):
    global terminando
    terminando = True
    log("supervisor", "señal de terminación: cerrando procesos")
    for p in procesos.values():
        if p.poll() is None:
            p.terminate()
    fin = time.time() + 10
    for p in procesos.values():
        try:
            p.wait(timeout=max(0.1, fin - time.time()))
        except subprocess.TimeoutExpired:
            p.kill()
    sys.exit(0)


def main():
    env = entorno_base()
    for sub in ("datos", "finops", "salida"):
        (ESTADO / sub).mkdir(parents=True, exist_ok=True)
    signal.signal(signal.SIGTERM, terminar)
    signal.signal(signal.SIGINT, terminar)

    provisionar(env)

    tabla = {n: (cmd, cwd) for n, cmd, cwd in tabla_procesos(env)}
    for nombre, (cmd, cwd) in tabla.items():
        lanzar(nombre, cmd, cwd, env)
        time.sleep(0.3)
    log("supervisor", f"{len(tabla)} procesos en marcha")

    while not terminando:
        time.sleep(1)
        for nombre, p in list(procesos.items()):
            codigo = p.poll()
            if codigo is not None:
                log("supervisor", f"!! {nombre} terminó con código {codigo}; se relanza en {REINICIO_SEG} s")
                time.sleep(REINICIO_SEG)
                cmd, cwd = tabla[nombre]
                lanzar(nombre, cmd, cwd, env)


if __name__ == "__main__":
    main()
