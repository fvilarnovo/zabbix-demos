"""Estado compartido entre los procesos del contenedor (archivos JSON atómicos en $ESTADO_DIR)."""
import json
import os
import pathlib
import time

DIR = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado"))
ESCENARIOS = DIR / "escenarios.json"
MUNDO = DIR / "mundo.json"
CORREDOR = pathlib.Path(__file__).resolve().parent / "web" / "static" / "corredor.json"

# Escenarios de la demo. Cada uno tiene una causa que llega primero a Zabbix y síntomas después:
# la regla CEP toma el primer evento de la ventana como causa.
CATALOGO = {
    "fibra-uf2": "Corte de fibra óptica en la UF-2",
    "energia-vegachi": "Peaje Vegachí sin energía (la planta de emergencia no arranca)",
    "bd-recaudo": "Base de datos de recaudo con bloqueos",
    "operador-tag": "Operador TAG de interoperabilidad sin respuesta",
    "gateway-memoria": "Fuga de memoria en el gateway de recaudo",
    "accidente-uf3": "Accidente en el km 100 (UF-3)",
    "lluvia-dolores": "Lluvia intensa en Alto de Dolores",
    "barrera-pbe": "Barrera atascada en el Peaje Puerto Berrío",
    "galibo": "Vehículo sobredimensionado en el gálibo del puente",
    "festivo": "Puente festivo: tráfico pico",
}
VELOCIDADES = (0.5, 1, 2, 4, 8)


def leer(ruta, defecto):
    try:
        return json.loads(pathlib.Path(ruta).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defecto


def escribir(ruta, datos):
    ruta = pathlib.Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    temporal = ruta.with_name(f"{ruta.name}.{os.getpid()}.tmp")
    temporal.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
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


def desactivar(nombre):
    if nombre not in CATALOGO:
        raise ValueError(f"Escenario desconocido: {nombre}")
    datos = escenarios()
    datos["activos"].pop(nombre, None)
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


def edad(nombre, activos=None):
    """Segundos reales desde que se activó el escenario, o None si no está activo."""
    activos = escenarios()["activos"] if activos is None else activos
    return time.time() - activos[nombre] if nombre in activos else None


def corredor():
    return json.loads(CORREDOR.read_text(encoding="utf-8"))
