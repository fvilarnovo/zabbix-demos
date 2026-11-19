#!/usr/bin/env python3
"""Supervisor genérico del contenedor de una demo: provisiona Zabbix y lanza los procesos de procesos.json.

Orden de arranque:
  1. /srv/provision/provisionar.py (si existe y PROVISION=1, por defecto 1): deja Zabbix listo. Si falla, se
     registra y la demo arranca igual.
  2. Los procesos de /srv/procesos.json (ruta en PROCESOS_JSON), en paralelo. Formato: lista de objetos
     {"nombre": str, "cmd": [str, ...], "cwd": str opcional (relativo a /srv), "env": {} opcional}.
     Los strings de cmd, cwd y env admiten ${VAR} del entorno.
Si un proceso muere, se relanza a los 3 s. Los logs salen por stdout con [nombre] como prefijo.
SIGTERM/SIGINT terminan todo ordenadamente.
"""
import json
import os
import pathlib
import re
import signal
import subprocess
import sys
import threading
import time

SRV = pathlib.Path(__file__).resolve().parent
REINICIO_SEG = 3
PROVISIONAR = SRV / "provision" / "provisionar.py"

procesos = {}
terminando = False


def log(nombre, texto):
    print(f"[{nombre}] {texto}", flush=True)


def entorno_base():
    e = dict(os.environ)
    e.setdefault("ESTADO_DIR", "/estado")
    e.setdefault("PYTHONUNBUFFERED", "1")
    return e


def expandir(texto, env):
    """Sustituye ${VAR} por el valor del entorno (vacío si no existe)."""
    return re.sub(r"\$\{(\w+)\}", lambda m: env.get(m.group(1), ""), texto)


def leer_tabla(env):
    """Lee PROCESOS_JSON y devuelve {nombre: (cmd, cwd, env_proceso)}."""
    ruta = pathlib.Path(env.get("PROCESOS_JSON", "/srv/procesos.json"))
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise SystemExit(f"[supervisor] !! no se pudo leer {ruta}: {e}")
    if not isinstance(datos, list):
        raise SystemExit(f"[supervisor] !! {ruta} debe contener una lista de procesos")
    tabla = {}
    for i, p in enumerate(datos):
        nombre, cmd = p.get("nombre"), p.get("cmd")
        if not nombre or not isinstance(cmd, list) or not cmd:
            raise SystemExit(f"[supervisor] !! proceso #{i + 1} inválido en {ruta}: requiere nombre y cmd (lista)")
        if nombre in tabla:
            raise SystemExit(f"[supervisor] !! nombre de proceso repetido: {nombre}")
        cmd = [expandir(str(c), env) for c in cmd]
        cwd = SRV / expandir(p["cwd"], env) if p.get("cwd") else SRV
        extra = {k: expandir(str(v), env) for k, v in (p.get("env") or {}).items()}
        tabla[nombre] = (cmd, cwd, extra)
    return tabla


def provisionar(env):
    if env.get("PROVISION", "1") != "1":
        log("provision", "PROVISION no es 1: se omite")
        return
    if not PROVISIONAR.exists():
        log("provision", f"no existe {PROVISIONAR}: se omite")
        return
    log("provision", "iniciando provisioning de Zabbix")
    try:
        r = subprocess.run([sys.executable, "-u", str(PROVISIONAR)], env=env, cwd=PROVISIONAR.parent)
    except OSError as e:
        log("provision", f"!! no se pudo ejecutar: {e}; la demo arranca igual")
        return
    log("provision", "terminado bien" if r.returncode == 0 else f"!! terminó con código {r.returncode}; la demo arranca igual")


def volcar(nombre, salida):
    for linea in iter(salida.readline, b""):
        log(nombre, linea.decode(errors="replace").rstrip())


def lanzar(nombre, cmd, cwd, env):
    try:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    except OSError as e:
        log("supervisor", f"!! no se pudo iniciar {nombre}: {e}")
        return None
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
    pathlib.Path(env["ESTADO_DIR"]).mkdir(parents=True, exist_ok=True)
    try:
        pathlib.Path("/salida").mkdir(parents=True, exist_ok=True)
    except OSError as e:  # fuera de Docker (p. ej. macOS) / no es editable: no es fatal
        log("supervisor", f"aviso: no se pudo crear /salida ({e})")
    signal.signal(signal.SIGTERM, terminar)
    signal.signal(signal.SIGINT, terminar)

    tabla = leer_tabla(env)
    provisionar(env)

    for nombre, (cmd, cwd, extra) in tabla.items():
        lanzar(nombre, cmd, cwd, {**env, **extra})
        time.sleep(0.3)
    log("supervisor", f"{len(tabla)} procesos en marcha")

    while not terminando:
        time.sleep(1)
        for nombre, p in list(procesos.items()):
            codigo = p.poll()
            if codigo is not None:
                log("supervisor", f"!! {nombre} terminó con código {codigo}; se relanza en {REINICIO_SEG} s")
                time.sleep(REINICIO_SEG)
                if terminando:
                    break
                cmd, cwd, extra = tabla[nombre]
                lanzar(nombre, cmd, cwd, {**env, **extra})


if __name__ == "__main__":
    main()
