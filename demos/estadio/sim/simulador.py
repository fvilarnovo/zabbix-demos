#!/usr/bin/env python3
"""Simulador del estadio: modelo de 1 s que alimenta la escena y envía todo a Zabbix por trapper.

Toda la operación es simulada: no hay agentes, sensores ni un estadio real. Cada escenario tiene una línea de tiempo
fija con la causa primero y los síntomas después, porque las reglas CEP toman el primer evento de la ventana como
causa. Sin ZABBIX_TRAPPER_HOST no envía nada (modo ensayo).

Apagón (segundos desde que empieza, a velocidad 1):
   0  cae el suministro de la red eléctrica (la causa)
  10  la UPS pasa a batería
  15  se apagan los reflectores de la cancha: el partido se detiene
  25  se apagan la cartelería LED y la pantalla gigante
  35  las TVs del estadio quedan fuera de línea; la publicidad deja de facturar
  50  arranca el generador: iluminación de emergencia al 50 %; las pantallas siguen sin energía
  60  la UPS vuelve a la línea y recarga
Molinetes: la base de datos de entradas deja de responder; los molinetes rechazan, se frena el ingreso y crece la fila.
Tablero: se dispara el interruptor del tablero comercial; la tienda queda sin terminales de cobro y deja de vender.
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

H_ENERGIA = "Estadio - Energia"
H_TABLEROS = "Estadio - Tableros"
H_LUCES = "Estadio - Iluminacion"
H_PANTALLAS = "Estadio - Pantallas"
H_ACCESOS = "Estadio - Accesos"
H_BOLETERIA = "Estadio - Boleteria"
H_TIENDA = "Estadio - Tienda"
H_NEGOCIO = "Estadio - Negocio"

# Línea de tiempo del apagón (segundos)
T_UPS, T_LUCES, T_LED, T_TVS, T_GENERADOR, T_UPS_LINEA = 10, 15, 25, 35, 50, 60
# Líneas de tiempo de los otros dos escenarios
T_RECHAZOS, T_INGRESO = 10, 20
T_POS, T_VENTAS = 10, 20
# Umbrales: los mismos que los triggers de Zabbix
UMBRAL_LUX = 800
UMBRAL_LED = 40
UMBRAL_TVS = 50
UMBRAL_PUBLICIDAD = 10000
UMBRAL_RECHAZO = 30
UMBRAL_INGRESO = 80
UMBRAL_FILA = 10
UMBRAL_POS = 3
UMBRAL_VENTAS = 20000

AFORO = 42000
LED_SEGMENTOS = 48
TVS = 64
LECTORES = 32
POS = 6
LUX_NOMINAL = 1400
PUERTAS = ("norte", "sur", "este", "oeste")
TABLEROS = ("iluminacion", "pantallas", "comercial", "servicios")
CORRIENTE_NOMINAL = {"iluminacion": 410.0, "pantallas": 265.0, "comercial": 120.0, "servicios": 185.0}
PUBLICIDAD_LED_H = 150000
PUBLICIDAD_GIGANTE_H = 36000
VENTAS_TIENDA_H = 86000
MINUTO_PARTIDO_SEG = 10  # un minuto de juego cada 10 s reales


def acercar(actual, objetivo, factor):
    return actual + (objetivo - actual) * min(1.0, factor)


class Mundo:
    def __init__(self):
        self.red = True
        self.tension = 13.2
        self.ups_bateria = False
        self.ups_pct = 100.0
        self.ups_carga = 42.0
        self.generador = False
        self.combustible = 96.0
        self.torres = [float(LUX_NOMINAL)] * 4
        self.gigante = True
        self.led = float(LED_SEGMENTOS)
        self.brillo = 85.0
        self.tvs = float(TVS)
        self.pub_h = float(PUBLICIDAD_LED_H + PUBLICIDAD_GIGANTE_H)
        self.corriente = dict(CORRIENTE_NOMINAL)
        self.temp_tablero = {t: 34.0 for t in TABLEROS}
        self.interruptor = {t: True for t in TABLEROS}
        self.ingreso = {p: 55.0 for p in PUERTAS}
        self.rechazo = 1.5
        self.fila = 3.0
        self.lectores = LECTORES
        self.asistencia = 38400.0
        self.bd = True
        self.bd_ms = 18.0
        self.pos = float(POS)
        self.ventas_h = float(VENTAS_TIENDA_H)
        self.clientes = 34.0
        self.juego_seg = 0.0
        self.goles = [0, 0]
        self.gol_t = 0.0
        self.gol_de = 0
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
    def lux(self):
        return sum(self.torres) / len(self.torres)

    @property
    def ingreso_total(self):
        return sum(self.ingreso.values())

    @property
    def minuto(self):
        return int(self.juego_seg / MINUTO_PARTIDO_SEG) % 96

    @property
    def carga_kw(self):
        return sum(self.corriente.values()) * 0.66

    def partido(self, dt, ahora):
        """El partido avanza solo con la cancha iluminada: sin reflectores se detiene."""
        if self.lux < UMBRAL_LUX:
            return
        previo = self.minuto
        self.juego_seg += dt
        if self.minuto < previo:
            self.goles = [0, 0]
            self.anotar("Comienza un nuevo partido", "info")
        for equipo, cada_seg in ((0, 170), (1, 520)):
            if 1 <= self.minuto <= 90 and random.random() < dt / cada_seg:
                self.goles[equipo] += 1
                self.gol_t, self.gol_de = ahora, equipo
                self.anotar(f"¡Gol de {'Zabbix FC' if equipo == 0 else 'Deportivo Downtime'}! {self.goles[0]}-{self.goles[1]}", "ok" if equipo == 0 else "info")

    def paso(self, dt, activos, velocidad, ahora):
        def edad(nombre):
            return (ahora - activos[nombre]) * velocidad if nombre in activos else None

        for nuevo in set(activos) - self.previos:
            self.anotar(f"Escenario: {estado.CATALOGO[nuevo]}", "escenario")
        if self.previos and not activos:
            self.anotar("Reset: operación normal", "ok")
        self.previos = set(activos)
        r = random.uniform

        # ---- Energía: la causa llega primero, de golpe
        a = edad("apagon")
        en = (lambda desde: a is not None and a >= desde)
        self.red = a is None
        self.tension = 13.2 + r(-0.05, 0.05) if self.red else 0.0
        self.generador = en(T_GENERADOR)
        self.ups_bateria = en(T_UPS) and not en(T_UPS_LINEA)
        self.ups_pct = max(20.0, self.ups_pct - 0.45 * dt) if self.ups_bateria else min(100.0, self.ups_pct + 0.25 * dt)
        self.ups_carga = acercar(self.ups_carga, 58 if self.ups_bateria else 42, 0.3 * dt) + r(-0.3, 0.3)
        self.combustible = max(5.0, self.combustible - 0.01 * dt) if self.generador else min(96.0, self.combustible + 0.05 * dt)

        # ---- Iluminación: sin red se apaga; el generador sostiene la de emergencia
        objetivo_lux = LUX_NOMINAL if not en(T_LUCES) else (LUX_NOMINAL * 0.5 if self.generador else 0)
        self.torres = [max(0.0, acercar(v, objetivo_lux, 0.9 * dt) + (r(-12, 12) if objetivo_lux else 0)) for v in self.torres]

        # ---- Pantallas, cartelería LED y TVs: cargas no esenciales, no entran al generador
        self.gigante = not en(T_LED)
        self.led = acercar(self.led, 0 if en(T_LED) else LED_SEGMENTOS, 0.9 * dt)
        self.brillo = acercar(self.brillo, 0 if en(T_LED) else 85, 0.9 * dt)
        self.tvs = acercar(self.tvs, 6 if en(T_TVS) else TVS, 0.7 * dt)
        objetivo_pub = PUBLICIDAD_LED_H * round(self.led) / LED_SEGMENTOS + (PUBLICIDAD_GIGANTE_H if self.gigante else 0)
        self.pub_h = acercar(self.pub_h, 0 if en(T_TVS) else objetivo_pub, 0.5 * dt)

        # ---- Tableros eléctricos
        t = edad("tablero")
        tab = (lambda desde: t is not None and t >= desde)
        self.interruptor["comercial"] = t is None
        objetivos = {
            "iluminacion": CORRIENTE_NOMINAL["iluminacion"] * objetivo_lux / LUX_NOMINAL,
            "pantallas": CORRIENTE_NOMINAL["pantallas"] * (0.04 if en(T_LED) else 1),
            "comercial": 0 if t is not None else CORRIENTE_NOMINAL["comercial"],
            "servicios": CORRIENTE_NOMINAL["servicios"],
        }
        for nombre in TABLEROS:
            self.corriente[nombre] = max(0.0, acercar(self.corriente[nombre], objetivos[nombre], 0.8 * dt) + (r(-1.5, 1.5) if objetivos[nombre] else 0))
            carga = self.corriente[nombre] / CORRIENTE_NOMINAL[nombre]
            self.temp_tablero[nombre] = acercar(self.temp_tablero[nombre], 24 + 10 * carga, 0.05 * dt) + r(-0.03, 0.03)

        # ---- Boletería y accesos: sin la base de entradas los molinetes no pueden validar
        m = edad("molinetes")
        mol = (lambda desde: m is not None and m >= desde)
        self.bd = m is None
        self.bd_ms = acercar(self.bd_ms, 18, 0.5 * dt) + r(-1, 1) if self.bd else 5000.0
        self.rechazo = max(0.0, acercar(self.rechazo, 74 if mol(T_RECHAZOS) else 1.5, 0.6 * dt) + r(-0.3, 0.3))
        for puerta in PUERTAS:
            self.ingreso[puerta] = max(0.0, acercar(self.ingreso[puerta], 4 if mol(T_INGRESO) else 55, 0.35 * dt) + r(-2, 2))
        self.fila = max(0.5, acercar(self.fila, 31 if mol(T_INGRESO) else 3, (0.035 if mol(T_INGRESO) else 0.12) * dt) + r(-0.05, 0.05))
        self.asistencia = 38400 + 900 * math.sin(ahora / 240)

        # ---- Tienda: sin el tablero comercial no hay terminales de cobro
        self.pos = acercar(self.pos, 0 if tab(T_POS) else POS, 0.9 * dt)
        self.ventas_h = max(0.0, acercar(self.ventas_h, 0 if tab(T_VENTAS) else VENTAS_TIENDA_H, 0.4 * dt) + (r(-900, 900) if not tab(T_VENTAS) else 0))
        self.clientes = max(0.0, acercar(self.clientes, 9 if tab(T_POS) else 34, 0.1 * dt) + r(-0.4, 0.4))

        self.partido(dt, ahora)

        self.marca("red", not self.red, "Energía: se cortó el suministro de la red")
        self.marca("ups", self.ups_bateria, "UPS: en batería")
        self.marca("lux", self.lux < UMBRAL_LUX, "Iluminación: cancha a oscuras, partido detenido")
        self.marca("led", self.led < UMBRAL_LED, "Cartelería LED y pantalla gigante apagadas")
        self.marca("tvs", self.tvs < UMBRAL_TVS, "TVs del estadio fuera de línea")
        self.marca("generador", self.generador, "Generador en marcha: iluminación de emergencia", "ok")
        self.marca("bd", not self.bd, "Boletería: la base de entradas no responde")
        self.marca("rechazo", self.rechazo > UMBRAL_RECHAZO, "Accesos: los molinetes rechazan entradas")
        self.marca("fila", self.fila > UMBRAL_FILA, "Accesos: fila larga en las puertas")
        self.marca("tablero", not self.interruptor["comercial"], "Tablero comercial: interruptor disparado")
        self.marca("pos", self.pos < UMBRAL_POS, "Tienda: terminales de cobro fuera de línea")


def valores(m):
    lote = []

    def poner(host, datos):
        lote.extend({"host": host, "key": k, "value": v} for k, v in datos.items())

    poner(H_ENERGIA, {
        "est.energia.red": int(m.red),
        "est.energia.tension": round(m.tension, 2),
        "est.energia.carga_kw": round(m.carga_kw, 1),
        "est.ups.en_bateria": int(m.ups_bateria),
        "est.ups.bateria_pct": round(m.ups_pct, 1),
        "est.ups.autonomia_min": round(m.ups_pct * 0.22, 1),
        "est.ups.carga_pct": round(m.ups_carga, 1),
        "est.gen.en_marcha": int(m.generador),
        "est.gen.combustible_pct": round(m.combustible, 1),
    })
    tableros = {}
    for nombre in TABLEROS:
        tableros[f"est.tablero.corriente[{nombre}]"] = round(m.corriente[nombre], 1)
        tableros[f"est.tablero.interruptor[{nombre}]"] = int(m.interruptor[nombre])
        tableros[f"est.tablero.temperatura[{nombre}]"] = round(m.temp_tablero[nombre], 1)
    poner(H_TABLEROS, tableros)
    luces = {f"est.luz.torre[{i + 1}]": round(v) for i, v in enumerate(m.torres)}
    luces["est.luz.cancha"] = round(m.lux)
    poner(H_LUCES, luces)
    poner(H_PANTALLAS, {
        "est.pantalla.gigante": int(m.gigante),
        "est.led.segmentos_ok": round(m.led),
        "est.led.brillo": round(m.brillo),
        "est.tv.en_linea": round(m.tvs),
        "est.pub.ingresos_h": round(m.pub_h),
    })
    accesos = {f"est.acceso.por_min[{p}]": round(v) for p, v in m.ingreso.items()}
    accesos.update({
        "est.acceso.total_min": round(m.ingreso_total),
        "est.acceso.rechazo_pct": round(m.rechazo, 1),
        "est.acceso.fila_min": round(m.fila, 1),
        "est.acceso.lectores_ok": m.lectores,
        "est.publico.asistencia": round(m.asistencia),
        "est.publico.ocupacion_pct": round(m.asistencia / AFORO * 100, 1),
    })
    poner(H_ACCESOS, accesos)
    poner(H_BOLETERIA, {"est.boleteria.bd": int(m.bd), "est.boleteria.bd_ms": round(m.bd_ms)})
    poner(H_TIENDA, {"est.tienda.pos_ok": round(m.pos), "est.tienda.ventas_h": round(m.ventas_h), "est.tienda.clientes": round(m.clientes)})
    poner(H_NEGOCIO, {"est.negocio.ingresos_h": round(m.pub_h + m.ventas_h), "est.negocio.partido_en_juego": int(m.lux >= UMBRAL_LUX)})
    return lote


def problemas_ensayo(m):
    """Problemas de mentira para ensayar la escena sin Zabbix. Con Zabbix conectado no se usan."""
    lista = []

    def p(condicion, nombre, sev, causa=False):
        if condicion:
            lista.append({"nombre": nombre, "severidad": sev, "causa": causa})

    p(not m.red, "Energía: sin suministro de la red externa", 4, True)
    p(m.ups_bateria, "UPS: en batería", 3)
    p(m.lux < UMBRAL_LUX, "Iluminación: nivel bajo en la cancha", 4)
    p(m.led < UMBRAL_LED, "Cartelería LED: segmentos apagados", 3)
    p(not m.gigante, "Pantalla gigante: apagada", 3)
    p(m.tvs < UMBRAL_TVS, "TVs del estadio: fuera de línea", 2)
    p(m.pub_h < UMBRAL_PUBLICIDAD, "Publicidad: sin emisión de anuncios", 3)
    p(not m.bd, "Boletería: base de datos de entradas sin respuesta", 4, True)
    p(m.rechazo > UMBRAL_RECHAZO, "Accesos: molinetes rechazando entradas", 3)
    p(m.ingreso_total < UMBRAL_INGRESO, "Accesos: ingreso de público detenido", 3)
    p(m.fila > UMBRAL_FILA, "Accesos: fila larga en las puertas", 4)
    p(not m.interruptor["comercial"], "Tablero comercial: interruptor disparado", 4, True)
    p(m.pos < UMBRAL_POS, "Tienda: terminales de cobro fuera de línea", 3)
    p(m.ventas_h < UMBRAL_VENTAS, "Tienda: ventas detenidas", 2)
    return lista


def foto(m, activos, velocidad, ahora):
    return {
        "ts": ahora,
        "velocidad": velocidad,
        "activos": sorted(activos),
        "energia": {
            "red": m.red, "tension": round(m.tension, 1), "carga_kw": round(m.carga_kw), "ups_bateria": m.ups_bateria,
            "ups_pct": round(m.ups_pct), "autonomia_min": round(m.ups_pct * 0.22), "generador": m.generador,
            "combustible": round(m.combustible),
        },
        "tableros": {n: {"a": round(m.corriente[n]), "cerrado": m.interruptor[n], "temp": round(m.temp_tablero[n])} for n in TABLEROS},
        "luces": {"torres": [round(v) for v in m.torres], "cancha": round(m.lux)},
        "pantallas": {"gigante": m.gigante, "led": round(m.led), "led_total": LED_SEGMENTOS, "tvs": round(m.tvs), "tvs_total": TVS, "pub_h": round(m.pub_h)},
        "accesos": {
            "por_min": round(m.ingreso_total), "puertas": {p: round(v) for p, v in m.ingreso.items()}, "rechazo": round(m.rechazo, 1),
            "fila": round(m.fila, 1), "asistencia": round(m.asistencia), "aforo": AFORO,
        },
        "boleteria": {"bd": m.bd},
        "tienda": {"pos": round(m.pos), "pos_total": POS, "ventas_h": round(m.ventas_h), "clientes": round(m.clientes)},
        "partido": {"minuto": m.minuto, "goles": m.goles, "gol_t": m.gol_t, "gol_de": m.gol_de, "en_juego": m.lux >= UMBRAL_LUX},
        "ingresos_h": round(m.pub_h + m.ventas_h),
        "bitacora": m.bitacora,
        "problemas_ensayo": problemas_ensayo(m),
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
        if set(activos) != m.previos:
            proximo_envio = 0.0  # la causa sale ya, sola: así llega antes que sus síntomas a cualquier velocidad
        m.paso(crudo * velocidad, activos, velocidad, ahora)
        estado.escribir(estado.MUNDO, foto(m, activos, velocidad, ahora))
        if sender and ahora >= proximo_envio:
            proximo_envio = ahora + ENVIO_SEG
            try:
                ok, info = sender.send_batch(valores(m))
                if not ok:
                    print(f"!! trapper: {info}", flush=True)
            except OSError as e:
                print(f"!! trapper: {e}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
