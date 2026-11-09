"""Estado compartido entre los procesos del contenedor (archivos JSON atómicos en $ESTADO_DIR)."""
import json
import os
import pathlib
import time

DIR = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado"))
ESCENARIOS = DIR / "escenarios.json"
MUNDO = DIR / "mundo.json"
LATENCIA = DIR / "latencia.json"

CATALOGO = {
    "cinta": "Cinta de equipaje: motor en sobrecorriente",
    "pasajes-error": "Sistema de pasajes bloqueado (errores)",
    "pasajes-lentos": "Sistema de pasajes lento",
    "scanner-1": "Scanner 1 fuera de servicio",
    "scanner-2": "Scanner 2 fuera de servicio",
    "scanner-3": "Scanner 3 fuera de servicio",
    "manga-1": "Manga 1 sin conexión",
    "manga-2": "Manga 2 sin conexión",
    "manga-3": "Manga 3 sin conexión",
    "ups": "UPS de terminal en batería",
    "pico": "Hora pico",
    "demoras": "Demoras repetidas",
    "vuelo-sin-salida": "Vuelo sin reporte de salida",
}
VELOCIDADES = (0.5, 1, 2, 4)


def leer(ruta, defecto):
    try:
        return json.loads(pathlib.Path(ruta).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defecto


def escribir(ruta, datos):
    ruta = pathlib.Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_name(f"{ruta.name}.{os.getpid()}.tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    temporal.replace(ruta)


def escenarios():
    datos = leer(ESCENARIOS, {})
    return {"activos": datos.get("activos", {}), "velocidad": datos.get("velocidad", 1)}


def activar(nombre):
    if nombre not in CATALOGO:
        raise ValueError(f"Escenario desconocido: {nombre}")
    datos = escenarios()
    datos["activos"].setdefault(nombre, time.time())
    escribir(ESCENARIOS, datos)


def restablecer():
    """Vuelve todo a la normalidad y conserva la velocidad elegida."""
    datos = escenarios()
    datos["activos"] = {}
    escribir(ESCENARIOS, datos)


def fijar_velocidad(valor):
    if valor not in VELOCIDADES:
        raise ValueError(f"Velocidad no soportada: {valor}")
    datos = escenarios()
    datos["velocidad"] = valor
    escribir(ESCENARIOS, datos)


def modo_pasajes():
    activos = escenarios()["activos"]
    if "pasajes-error" in activos:
        return "error"
    if "pasajes-lentos" in activos:
        return "lento"
    return "normal"
