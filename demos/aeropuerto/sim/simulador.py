#!/usr/bin/env python3
"""Simulador de la terminal: modelo de 1 s que alimenta la escena 3D y envía todo a Zabbix por trapper.

Toda la operación es simulada: no hay agentes ni dispositivos. Cada escenario tiene una línea de tiempo con la causa
primero y los síntomas después, porque las reglas CEP toman el primer evento de la ventana como causa.
Sin ZABBIX_TRAPPER_HOST no envía nada (modo ensayo).
"""
import math
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

HOST_TERMINAL = "Aeropuerto - Terminal"
HOST_CINTA = "Aeropuerto - Cinta 1"
HOST_UPS = "Aeropuerto - UPS T1"
SCANNERS = (1, 2, 3)
MANGAS = (1, 2, 3)

# Umbrales: los mismos valores que los triggers de Zabbix. La hora pico queda siempre por debajo.
UMBRAL_COLA_CHECKIN = 100
UMBRAL_COLA_SEGURIDAD = 80
UMBRAL_BACKLOG = 100
UMBRAL_CORRIENTE = 28
UMBRAL_DEMORADOS = 2

DESTINOS = ("Cancún", "Monterrey", "Guadalajara", "Bogotá", "Lima", "Buenos Aires", "Santiago", "Tijuana", "Mérida", "Panamá")
VUELOS_DEMORAS = ("ZB401", "ZB402", "ZB403")
VUELO_SEGUIDO = "ZB901"
CICLO_VUELO_SEG = 240
ESPERA_SALIDA_SEG = 30


def acercar(actual, objetivo, factor):
    return actual + (objetivo - actual) * min(1.0, factor)


class Mundo:
    def __init__(self):
        self.cola_checkin = 24.0
        self.cola_seguridad = 16.0
        self.backlog = 0.0
        self.valijas_h = 1400.0
        self.pasajeros = 820.0
        self.corriente = 18.0
        self.temp_motor = 44.0
        self.vel_cinta = 1.6
        self.demorados = 0
        self.ups_bateria = 100.0
        self.ups_autonomia = 46.0
        self.ups_carga = 42.0
        self.bitacora = []
        self.previos = set()
        self.marcas = set()
        self.espera_demora = 0.0

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

    def paso(self, dt, activos, velocidad, latencia, ahora):
        def edad(nombre):
            return (ahora - activos[nombre]) * velocidad if nombre in activos else None

        for nuevo in set(activos) - self.previos:
            self.anotar(f"Escenario: {estado.CATALOGO[nuevo]}", "escenario")
        if self.previos and not activos:
            self.anotar("Reset: operación normal", "ok")
        self.previos = set(activos)

        pico = "pico" in activos
        multiplicador = 2.2 if pico else 1.0
        objetivo_cola_c = 62 if pico else 24
        objetivo_cola_s = 48 if pico else 16

        # Cinta: la sobrecorriente es la causa; a los 8 s el motor se protege y la cinta se detiene
        cinta = edad("cinta")
        detenida = cinta is not None and cinta >= 8
        self.corriente = acercar(self.corriente, 34.5 if cinta is not None else 18 * (1.15 if pico else 1), 0.35 * dt) + random.uniform(-0.2, 0.2)
        self.temp_motor = acercar(self.temp_motor, 78 if cinta is not None else 44, 0.05 * dt) + random.uniform(-0.1, 0.1)
        self.vel_cinta = acercar(self.vel_cinta, 0 if detenida else 1.6, 0.4 * dt)
        self.backlog = max(0.0, self.backlog + (3.4 * dt if detenida else -7 * dt))
        self.valijas_h = acercar(self.valijas_h, 0 if detenida else 1400 * multiplicador, 0.25 * dt) + random.uniform(-6, 6)

        # Check-in: su capacidad depende de la latencia y los errores reales medidos en las trazas
        err = latencia.get("err_pct", 0)
        p95 = latencia.get("p95_ms", 300)
        capacidad = 1.0
        if latencia.get("n", 0) >= 3:
            if err > 30:
                capacidad = 0.10
            elif p95 > 1500:
                capacidad = 0.30
        if cinta is not None and cinta >= 25:
            capacidad = min(capacidad, 0.25)
        llegadas = 1.2 * multiplicador
        servicio = llegadas * capacidad * max(0.6, min(1.6, self.cola_checkin / objetivo_cola_c)) if capacidad < 1 else llegadas * self.cola_checkin / objetivo_cola_c
        self.cola_checkin = min(230.0, max(0.0, self.cola_checkin + (llegadas - servicio) * dt))

        # Seguridad: cada scanner fuera de servicio resta capacidad
        fuera = sum(f"scanner-{n}" in activos for n in SCANNERS)
        capacidad_s = {0: 1.0, 1: 0.32, 2: 0.14, 3: 0.0}[fuera]
        llegadas_s = 1.0 * multiplicador
        servicio_s = llegadas_s * capacidad_s if capacidad_s < 1 else llegadas_s * self.cola_seguridad / objetivo_cola_s
        self.cola_seguridad = min(200.0, max(0.0, self.cola_seguridad + (llegadas_s - servicio_s) * dt))

        ola = 60 * math.sin(ahora / 300 * 2 * math.pi)
        self.pasajeros = acercar(self.pasajeros, (1180 if pico else 820) + ola + self.cola_checkin * 1.5 + self.cola_seguridad, 0.05 * dt)

        # Vuelos demorados: siempre después de sus causas
        objetivo_dem = 0
        if self.backlog > 150:
            objetivo_dem = min(6, 2 + int((self.backlog - 150) / 90))
        if self.cola_seguridad > 120:
            objetivo_dem = max(objetivo_dem, 2)
        if self.cola_checkin > 140:
            objetivo_dem = max(objetivo_dem, 2)
        if "demoras" in activos:
            objetivo_dem = max(objetivo_dem, 3)
        self.espera_demora += dt
        if self.espera_demora >= 6 and self.demorados != objetivo_dem:
            self.demorados += 1 if objetivo_dem > self.demorados else -1
            self.espera_demora = 0.0

        # UPS
        ups = edad("ups")
        if ups is not None:
            self.ups_bateria = max(8.0, self.ups_bateria - 0.45 * dt)
            self.ups_autonomia = max(2.0, self.ups_autonomia - 0.28 * dt)
            self.ups_carga = acercar(self.ups_carga, 71, 0.2 * dt)
        else:
            self.ups_bateria = min(100.0, self.ups_bateria + 1.5 * dt)
            self.ups_autonomia = min(46.0, self.ups_autonomia + 1.0 * dt)
            self.ups_carga = acercar(self.ups_carga, 42, 0.2 * dt)

        self.marca("corriente", self.corriente > UMBRAL_CORRIENTE, f"Cinta: corriente supera {UMBRAL_CORRIENTE} A")
        self.marca("detenida", self.vel_cinta < 0.1, "Cinta detenida: las valijas no avanzan")
        self.marca("backlog", self.backlog > UMBRAL_BACKLOG, "Equipaje: acumulación sobre el umbral")
        self.marca("cola_c", self.cola_checkin > UMBRAL_COLA_CHECKIN, "Cola de check-in sobre el umbral")
        self.marca("cola_s", self.cola_seguridad > UMBRAL_COLA_SEGURIDAD, "Cola de seguridad sobre el umbral")
        self.marca("demorados", self.demorados >= UMBRAL_DEMORADOS, f"{self.demorados} vuelos demorados")

    def vuelos(self, ahora):
        base = int(ahora // 180)
        hora = time.localtime(ahora)
        tablero = []
        for i in range(8):
            minutos = hora.tm_hour * 60 + hora.tm_min - (hora.tm_min % 5) + 5 + i * 12
            n = base + i
            estado_vuelo = "Embarcando" if i < 2 else "En hora"
            if i < self.demorados:
                estado_vuelo = "Demorado"
            tablero.append({
                "codigo": f"ZB{410 + (n * 7) % 480}",
                "destino": DESTINOS[n % len(DESTINOS)],
                "hora": f"{(minutos // 60) % 24:02d}:{minutos % 60:02d}",
                "puerta": f"A{1 + (n % 12)}",
                "estado": estado_vuelo,
            })
        return tablero


def valores(m, activos, velocidad, ahora):
    r = random.uniform

    def edad(nombre):
        return (ahora - activos[nombre]) * velocidad if nombre in activos else None

    lote = []

    def poner(host, datos):
        lote.extend({"host": host, "key": k, "value": v} for k, v in datos.items())

    terminal = {
        "aero.pasajeros": int(m.pasajeros),
        "aero.cola.checkin": int(m.cola_checkin),
        "aero.cola.seguridad": int(m.cola_seguridad),
        "aero.equipaje.valijas_h": max(0, int(m.valijas_h)),
        "aero.equipaje.backlog": int(m.backlog),
        "aero.vuelos.demorados": m.demorados,
    }
    # Frecuencia: tres vuelos se demoran uno tras otro y siguen demorados hasta el reset
    demoras = edad("demoras")
    for i, vuelo in enumerate(VUELOS_DEMORAS):
        terminal[f"aero.vuelo.demora[{vuelo}]"] = int(demoras is not None and demoras >= i * 15)
    # Evento esperado: cada vuelo cierra embarque y reporta su salida ESPERA_SALIDA_SEG después
    fase = ahora % CICLO_VUELO_SEG
    sin_salida = edad("vuelo-sin-salida") is not None
    terminal[f"aero.vuelo.embarque[{VUELO_SEGUIDO}]"] = int(sin_salida or fase < ESPERA_SALIDA_SEG)
    terminal[f"aero.vuelo.salida[{VUELO_SEGUIDO}]"] = int(not sin_salida and ESPERA_SALIDA_SEG <= fase < ESPERA_SALIDA_SEG + 20)
    poner(HOST_TERMINAL, terminal)

    poner(HOST_CINTA, {
        "aero.cinta.corriente": round(m.corriente, 1),
        "aero.cinta.temp_motor": round(m.temp_motor, 1),
        "aero.cinta.velocidad": round(m.vel_cinta, 2),
        "aero.cinta.estado": int(m.vel_cinta >= 0.1),
    })
    for n in SCANNERS:
        fuera = f"scanner-{n}" in activos
        poner(f"Aeropuerto - Scanner {n}", {
            "aero.scanner.estado": int(not fuera),
            "aero.scanner.pax_min": 0 if fuera else round(r(7.5, 9.5), 1),
            "aero.scanner.temp_tubo": round(r(36, 39) if not fuera else r(25, 27), 1),
        })
    for n in MANGAS:
        fuera = f"manga-{n}" in activos
        poner(f"Aeropuerto - Manga {n}", {
            "aero.manga.conectada": int(not fuera),
            "aero.manga.presion_bar": round(r(4.9, 5.2) if not fuera else r(1.2, 1.6), 2),
        })
    en_bateria = "ups" in activos
    poner(HOST_UPS, {
        "aero.ups.en_bateria": int(en_bateria),
        "aero.ups.bateria_pct": round(m.ups_bateria, 1),
        "aero.ups.autonomia_min": round(m.ups_autonomia, 1),
        "aero.ups.carga_pct": round(m.ups_carga, 1),
        "aero.ups.tension_entrada": 0 if en_bateria else round(r(125, 129), 1),
    })
    return lote


def problemas_ensayo(m, activos):
    """Problemas de mentira para ensayar la escena sin Zabbix. Con Zabbix conectado no se usan."""
    lista = []

    def p(nombre, sev, causa=False):
        lista.append({"nombre": nombre, "severidad": sev, "causa": causa})

    if m.corriente > UMBRAL_CORRIENTE:
        p("Cinta de equipaje: sobrecorriente del motor", 4, True)
    if m.vel_cinta < 0.1:
        p("Cinta de equipaje detenida", 4)
    if "pasajes-error" in activos:
        p("APM pasajes: tasa de errores alta", 4, True)
    if "pasajes-lentos" in activos:
        p("APM pasajes: latencia alta", 3, True)
    for n in SCANNERS:
        if f"scanner-{n}" in activos:
            p(f"Scanner {n} fuera de servicio", 4, True)
    for n in MANGAS:
        if f"manga-{n}" in activos:
            p(f"Manga {n} sin conexión", 3)
    if "ups" in activos:
        p("UPS de terminal en batería", 3)
    if m.backlog > UMBRAL_BACKLOG:
        p("Equipaje: acumulación alta", 3)
    if m.cola_checkin > UMBRAL_COLA_CHECKIN:
        p("Cola de check-in sobre el umbral", 3)
    if m.cola_seguridad > UMBRAL_COLA_SEGURIDAD:
        p("Cola de seguridad sobre el umbral", 3)
    if m.demorados >= UMBRAL_DEMORADOS:
        p("Vuelos demorados", 2)
    return lista


def foto(m, activos, velocidad, latencia, ahora):
    return {
        "ts": ahora,
        "velocidad": velocidad,
        "activos": sorted(activos),
        "kpi": {
            "pasajeros": int(m.pasajeros),
            "cola_checkin": int(m.cola_checkin),
            "cola_seguridad": int(m.cola_seguridad),
            "valijas_h": max(0, int(m.valijas_h)),
            "backlog": int(m.backlog),
            "vuelos_demorados": m.demorados,
            "latencia_ms": latencia.get("p95_ms", 0),
            "errores_pct": latencia.get("err_pct", 0),
        },
        "ot": {
            "cinta": {"corriente": round(m.corriente, 1), "temp": round(m.temp_motor, 1), "vel": round(m.vel_cinta, 2)},
            "scanners": [{"id": n, "ok": f"scanner-{n}" not in activos} for n in SCANNERS],
            "mangas": [{"id": n, "ok": f"manga-{n}" not in activos} for n in MANGAS],
            "ups": {"en_bateria": "ups" in activos, "bateria": round(m.ups_bateria), "autonomia": round(m.ups_autonomia)},
        },
        "vuelos": m.vuelos(ahora),
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
        latencia = estado.leer(estado.LATENCIA, {})
        m.paso(crudo * velocidad, activos, velocidad, latencia, ahora)
        estado.escribir(estado.MUNDO, foto(m, activos, velocidad, latencia, ahora))
        if sender and ahora >= proximo_envio:
            proximo_envio = ahora + ENVIO_SEG
            try:
                ok, info = sender.send_batch(valores(m, activos, velocidad, ahora))
                if not ok:
                    print(f"!! trapper: {info}", flush=True)
            except OSError as e:
                print(f"!! trapper: {e}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
