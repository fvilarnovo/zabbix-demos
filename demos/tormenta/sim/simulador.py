#!/usr/bin/env python3
"""Simulador de la planta y del satélite: modelo de 1 s que alimenta la escena y envía todo a Zabbix por trapper.

Toda la operación es simulada: no hay agentes, sensores ni datos de clima espacial reales. Cada escenario tiene una
línea de tiempo fija con la causa primero y los síntomas después, porque las reglas CEP toman el primer evento de la
ventana como causa. Sin ZABBIX_TRAPPER_HOST no envía nada (modo ensayo).

Tormenta (segundos desde que empieza, a velocidad 1):
   0  el índice Kp sube a 8: tormenta geomagnética G4 (la causa)
  10  errores por radiación (SEU) en la computadora del satélite
  25  el sensor de estrellas pierde el enganche y crece el error de apuntado
  40  la hora GPS de la planta se desvía
  55  corriente inducida (GIC) en el transformador principal
  70  los operadores insertan barras: la potencia baja al 70 %
  90  se degrada la señal de bajada del satélite
Bomba: la bomba B de la piscina de combustible se dispara y la temperatura sube despacio. No tiene que ver con la tormenta.
"""
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import estado_demo as estado  # noqa: E402
from zbx_sender import ZabbixSender  # noqa: E402

TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
ENVIO_SEG = 5

H_CLIMA = "Tormenta - Clima espacial"
H_SAT = "Tormenta - ZABBIXSAT-1"
H_ESTACION = "Tormenta - Estacion terrena"
H_REACTOR = "Tormenta - Planta reactor"
H_ELECTRICA = "Tormenta - Planta electrica"
H_PISCINA = "Tormenta - Planta piscina"
H_TI = "Tormenta - Planta TI"
H_NEGOCIO = "Tormenta - Negocio"

# Línea de tiempo de la tormenta (segundos)
T_SEU, T_ESTRELLAS, T_GPS, T_GIC, T_POTENCIA, T_ENLACE = 10, 25, 40, 55, 70, 90
# Umbrales: los mismos que los triggers de Zabbix
UMBRAL_KP = 7
UMBRAL_SEU = 5
UMBRAL_GPS_MS = 1
UMBRAL_GIC = 30
UMBRAL_POTENCIA = 95
UMBRAL_SNR = 6
UMBRAL_PISCINA = 36

POTENCIA_NOMINAL_MW = 680
PRECIO_MWH = 1850
ORBITA_SEG = 90


def acercar(actual, objetivo, factor):
    return actual + (objetivo - actual) * min(1.0, factor)


class Mundo:
    def __init__(self):
        self.kp = 2.7
        self.protones = 3.0
        self.seu = 0.4
        self.estrellas = True
        self.apuntado = 0.02
        self.ruedas = [2100.0, -1800.0, 1500.0]
        self.bateria = 92.0
        self.altitud = 520.0
        self.snr = 13.0
        self.ber = 1e-7
        self.gps_ms = 0.02
        self.gic = 1.5
        self.temp_trafo = 61.0
        self.potencia = 100.0
        self.barras = 12.0
        self.frecuencia = 60.0
        self.presion = 7.03
        self.nivel = 92.0
        self.recirc = 100.0
        self.piscina = 31.0
        self.nivel_piscina = 11.8
        self.imagenes_h = 42.0
        self.bitacora = []
        self.previos = set()
        self.marcas = set()

    def anotar(self, texto, tipo="info"):
        self.bitacora.append({"t": time.time(), "txt": texto, "tipo": tipo})
        del self.bitacora[:-40]

    def marca(self, clave, condicion, texto, tipo="alerta"):
        """Anota un cruce de umbral una sola vez, hasta que vuelva a la normalidad."""
        if condicion and clave not in self.marcas:
            self.marcas.add(clave)
            self.anotar(texto, tipo)
        elif not condicion:
            self.marcas.discard(clave)

    @property
    def mw(self):
        return POTENCIA_NOMINAL_MW * self.potencia / 100

    def eclipse(self, ahora):
        return (ahora % ORBITA_SEG) / ORBITA_SEG > 0.7

    def paso(self, dt, activos, velocidad, ahora):
        def edad(nombre):
            return (ahora - activos[nombre]) * velocidad if nombre in activos else None

        for nuevo in set(activos) - self.previos:
            self.anotar(f"Escenario: {estado.CATALOGO[nuevo]}", "escenario")
        if self.previos and not activos:
            self.anotar("Reset: operación normal", "ok")
        self.previos = set(activos)

        t = edad("tormenta")
        en = (lambda desde: t is not None and t >= desde)
        r = random.uniform

        # Clima espacial: la causa llega primero, de golpe
        self.kp = 8.3 + r(-0.2, 0.2) if en(0) else acercar(self.kp, 2.7, 0.3 * dt) + r(-0.02, 0.02)
        self.protones = acercar(self.protones, 900 if en(0) else 3, 0.25 * dt)

        # Satélite
        self.seu = acercar(self.seu, 14 if en(T_SEU) else 0.4, 0.8 * dt) + r(-0.1, 0.1)
        self.estrellas = not en(T_ESTRELLAS)
        self.apuntado = acercar(self.apuntado, 2.4 if en(T_ESTRELLAS) else 0.02, 0.4 * dt)
        objetivo_ruedas = [5600, -5200, 4800] if en(T_ESTRELLAS) else [2100, -1800, 1500]
        self.ruedas = [acercar(v, o, 0.3 * dt) + r(-15, 15) for v, o in zip(self.ruedas, objetivo_ruedas)]
        self.altitud = self.altitud - (0.004 * dt if en(0) else -0.001 * dt)
        self.altitud = max(510.0, min(520.0, self.altitud))
        eclipse = self.eclipse(ahora)
        self.bateria = max(55.0, min(98.0, self.bateria + (-0.18 if eclipse else 0.22) * dt))

        # Estación terrena
        self.snr = acercar(self.snr, 3.2 if en(T_ENLACE) else 13.0, 0.6 * dt) + r(-0.15, 0.15)
        self.ber = 2e-3 if en(T_ENLACE) else 1e-7
        self.imagenes_h = acercar(self.imagenes_h, 9 if en(T_ENLACE) else 42, 0.1 * dt)

        # Planta: TI, red eléctrica y reactor
        self.gps_ms = acercar(self.gps_ms, 3.8 if en(T_GPS) else 0.02, 0.5 * dt)
        self.gic = acercar(self.gic, 46 if en(T_GIC) else 1.5, 0.8 * dt) + r(-0.4, 0.4)
        self.temp_trafo = acercar(self.temp_trafo, 84 if en(T_GIC) else 61, 0.06 * dt) + r(-0.05, 0.05)
        # Los operadores insertan barras por procedimiento: la potencia baja de forma controlada
        self.potencia = acercar(self.potencia, 70 if en(T_POTENCIA) else 100, 0.12 * dt)
        self.barras = acercar(self.barras, 38 if en(T_POTENCIA) else 12, 0.12 * dt)
        self.recirc = acercar(self.recirc, 72 if en(T_POTENCIA) else 100, 0.12 * dt)
        self.frecuencia = 60 + r(-0.02, 0.02) + (r(-0.08, 0.08) if en(T_GIC) else 0)
        self.presion = 7.03 + r(-0.01, 0.01)
        self.nivel = 92 + r(-0.4, 0.4)

        # Piscina de combustible gastado: con una sola bomba la temperatura sube despacio
        b = edad("bomba")
        self.piscina = acercar(self.piscina, 44 if b is not None else 31, (0.025 if b is not None else 0.08) * dt) + r(-0.02, 0.02)
        self.nivel_piscina = 11.8 + r(-0.005, 0.005)

        self.marca("kp", self.kp >= UMBRAL_KP, f"Clima espacial: Kp {self.kp:.1f}, tormenta G4")
        self.marca("seu", self.seu > UMBRAL_SEU, "ZABBIXSAT-1: errores por radiación")
        self.marca("estrellas", not self.estrellas, "ZABBIXSAT-1: sensor de estrellas sin enganche")
        self.marca("gps", self.gps_ms > UMBRAL_GPS_MS, "Planta: la hora GPS se desvía")
        self.marca("gic", self.gic > UMBRAL_GIC, "Transformador: corriente inducida alta")
        self.marca("potencia", self.potencia < UMBRAL_POTENCIA, "Reactor: se insertan barras, baja la potencia")
        self.marca("snr", self.snr < UMBRAL_SNR, "Estación terrena: enlace degradado")
        self.marca("bomba", b is not None, "Piscina: bomba B disparada")
        self.marca("piscina", self.piscina > UMBRAL_PISCINA, "Piscina: temperatura sobre el umbral")


def valores(m, activos, ahora):
    lote = []

    def poner(host, datos):
        lote.extend({"host": host, "key": k, "value": v} for k, v in datos.items())

    bomba_b = "bomba" not in activos
    poner(H_CLIMA, {"tor.kp": round(m.kp, 1), "tor.protones": round(m.protones, 1)})
    poner(H_SAT, {
        "tor.sat.seu": round(max(0, m.seu), 1),
        "tor.sat.estrellas": int(m.estrellas),
        "tor.sat.apuntado": round(m.apuntado, 3),
        "tor.sat.rueda[1]": round(m.ruedas[0]),
        "tor.sat.rueda[2]": round(m.ruedas[1]),
        "tor.sat.rueda[3]": round(m.ruedas[2]),
        "tor.sat.bateria": round(m.bateria, 1),
        "tor.sat.eclipse": int(m.eclipse(ahora)),
        "tor.sat.altitud": round(m.altitud, 2),
    })
    poner(H_ESTACION, {
        "tor.estacion.snr": round(m.snr, 1),
        "tor.estacion.ber": m.ber,
        "tor.estacion.imagenes_h": round(m.imagenes_h),
    })
    poner(H_REACTOR, {
        "tor.reactor.potencia": round(m.potencia, 1),
        "tor.reactor.barras": round(m.barras, 1),
        "tor.reactor.presion": round(m.presion, 2),
        "tor.reactor.nivel": round(m.nivel, 1),
        "tor.reactor.recirculacion": round(m.recirc, 1),
    })
    poner(H_ELECTRICA, {
        "tor.electrica.mw": round(m.mw, 1),
        "tor.electrica.frecuencia": round(m.frecuencia, 2),
        "tor.electrica.gic": round(max(0, m.gic), 1),
        "tor.electrica.temp_trafo": round(m.temp_trafo, 1),
        "tor.electrica.red_externa": 1,
        "tor.electrica.diesel": 0,
    })
    poner(H_PISCINA, {
        "tor.piscina.temperatura": round(m.piscina, 2),
        "tor.piscina.nivel": round(m.nivel_piscina, 3),
        "tor.piscina.bomba[A]": 1,
        "tor.piscina.bomba[B]": int(bomba_b),
    })
    poner(H_TI, {"tor.ti.gps_desfase": round(m.gps_ms, 3), "tor.ti.diodo": 1})
    poner(H_NEGOCIO, {"tor.negocio.mw": round(m.mw, 1), "tor.negocio.ingresos_h": round(m.mw * PRECIO_MWH)})
    return lote


def problemas_ensayo(m, activos):
    """Problemas de mentira para ensayar la escena sin Zabbix. Con Zabbix conectado no se usan."""
    lista = []

    def p(nombre, sev, causa=False):
        lista.append({"nombre": nombre, "severidad": sev, "causa": causa})

    tormenta = m.kp >= UMBRAL_KP
    if tormenta:
        p("Clima espacial: tormenta geomagnética (Kp ≥ 7)", 4, True)
    if m.seu > UMBRAL_SEU:
        p("ZABBIXSAT-1: errores por radiación altos", 3)
    if not m.estrellas:
        p("ZABBIXSAT-1: sensor de estrellas sin enganche", 4)
    if m.gps_ms > UMBRAL_GPS_MS:
        p("Planta TI: desfase de la hora GPS", 3)
    if m.gic > UMBRAL_GIC:
        p("Transformador principal: corriente inducida alta", 4)
    if m.potencia < UMBRAL_POTENCIA:
        p("Reactor: potencia reducida", 3)
    if m.snr < UMBRAL_SNR:
        p("Estación terrena: enlace degradado", 3)
    if "bomba" in activos:
        p("Piscina: bomba B de enfriamiento detenida", 4, True)
    if m.piscina > UMBRAL_PISCINA:
        p("Piscina: temperatura alta", 3)
    return lista


def foto(m, activos, velocidad, ahora):
    edad = (ahora - activos["tormenta"]) * velocidad if "tormenta" in activos else None
    return {
        "ts": ahora,
        "velocidad": velocidad,
        "activos": sorted(activos),
        "tormenta_s": edad,
        "clima": {"kp": round(m.kp, 1), "protones": round(m.protones)},
        "satelite": {
            "seu": round(max(0, m.seu), 1), "estrellas": m.estrellas, "apuntado": round(m.apuntado, 2),
            "ruedas": [round(v) for v in m.ruedas], "bateria": round(m.bateria), "eclipse": m.eclipse(ahora),
            "altitud": round(m.altitud, 1), "fase": (ahora % ORBITA_SEG) / ORBITA_SEG,
        },
        "estacion": {"snr": round(m.snr, 1), "imagenes_h": round(m.imagenes_h)},
        "planta": {
            "potencia": round(m.potencia, 1), "barras": round(m.barras, 1), "mw": round(m.mw), "frecuencia": round(m.frecuencia, 2),
            "gic": round(max(0, m.gic), 1), "temp_trafo": round(m.temp_trafo, 1), "presion": round(m.presion, 2),
            "nivel": round(m.nivel), "gps_ms": round(m.gps_ms, 2), "piscina": round(m.piscina, 1),
            "bomba_b": "bomba" not in activos, "ingresos_h": round(m.mw * PRECIO_MWH),
        },
        "bitacora": m.bitacora,
        "problemas_ensayo": problemas_ensayo(m, activos),
    }


def main():
    m = Mundo()
    sender = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT) if TRAPPER_HOST else None
    print(f"Simulador en marcha; trapper {'hacia ' + TRAPPER_HOST if sender else 'desactivado (ensayo)'}", flush=True)
    proximo_envio = 0.0
    previo = time.time()
    while True:
        ahora = time.time()
        crudo = ahora - previo
        previo = ahora
        esc = estado.escenarios()
        activos, velocidad = esc["activos"], esc["velocidad"]
        m.paso(crudo * velocidad, activos, velocidad, ahora)
        estado.escribir(estado.MUNDO, foto(m, activos, velocidad, ahora))
        if sender and ahora >= proximo_envio:
            proximo_envio = ahora + ENVIO_SEG
            try:
                ok, info = sender.send_batch(valores(m, activos, ahora))
                if not ok:
                    print(f"!! trapper: {info}", flush=True)
            except OSError as e:
                print(f"!! trapper: {e}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
