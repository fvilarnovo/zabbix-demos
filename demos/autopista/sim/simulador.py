#!/usr/bin/env python3
"""Simulador del corredor vial de la demo: alimenta la escena 3D y envía todo a Zabbix por trapper.

- Tránsito microscópico 1D por sentido (modelo IDM de seguimiento vehicular), con adelantamiento en las zonas
  habilitadas, accesos en las poblaciones y demanda según la hora del día.
- Tres plazas de peaje con carriles TAG y manuales, colas FIFO, barreras y modo contingencia.
- Cada vehículo que paga hace una transacción REAL contra la app de recaudo (peaje-gateway): sus trazas llegan al
  APM de Zabbix y su latencia o error decide cuánto tarda en abrirse la barrera.
- Equipos ITS (nodos de fibra, cámaras DAI, radares, PMV, estaciones meteorológicas, gálibo) como hosts propios.

Cada escenario tiene una línea de tiempo: la causa llega primero a Zabbix y los síntomas después, porque la regla CEP
toma el primer evento de la ventana como causa. Sin ZABBIX_TRAPPER_HOST no envía nada (modo ensayo).
"""
import bisect
import collections
import concurrent.futures
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import estado_demo as estado  # noqa: E402
from zbx_sender import ZabbixSender  # noqa: E402

TRAPPER_HOST = os.environ.get("ZABBIX_TRAPPER_HOST", "")
TRAPPER_PORT = int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051"))
GATEWAY = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8111")
ENVIO_SEG = 5
TICK_SEG = 0.2
FOTO_SEG = 0.5
BOGOTA = timezone(timedelta(hours=-5))

H_CORREDOR = "Autopista - Corredor"
H_PLATAFORMA = "Autopista - Plataforma de recaudo"
H_PEAJE = {"VEG": "Autopista - Peaje Vegachi", "SIS": "Autopista - Peaje Santa Isabel", "PBE": "Autopista - Peaje Puerto Berrio"}


def h_its(dispositivo):
    return f"Autopista - ITS {dispositivo}"


C = estado.corredor()
L_KM = C["longitud"]
L_M = L_KM * 1000
CAT = {int(k): v for k, v in C["categorias"].items()}
CAT_IDS = list(CAT)
CAT_PESOS = [CAT[k]["cuota"] for k in CAT_IDS]
ABANICO = C["abanico_m"]
UNION = C["union_m"]
ANCHO = C["carril_ancho"]
LAT_VIA = 1.8
LAT_ADELANTO = 5.4
# Demanda relativa por hora (0 a 23, hora de Bogotá) y vehículos/h por sentido en la hora pico.
PERFIL = [0.18, 0.14, 0.12, 0.12, 0.2, 0.45, 0.75, 0.9, 0.86, 0.8, 0.82, 0.85, 0.88, 0.86, 0.85, 0.9, 0.95, 1.0, 0.92, 0.72, 0.52, 0.38, 0.3, 0.22]
DEMANDA_PICO = 330
UMBRAL_LENTO = 2.5  # m/s: por debajo, el vehículo cuenta como detenido en cola

# Umbrales: los mismos que los triggers de Zabbix (tools/generar_export.py).
UMBRAL_COLA_PLAZA = 8
UMBRAL_TAG_RECHAZO = 20


def s_de(sentido, x):
    return x / 1000 if sentido == "A" else L_KM - x / 1000


def x_de(sentido, s):
    return s * 1000 if sentido == "A" else (L_KM - s) * 1000


def limite(s):
    for a, b, v in C["limites"]:
        if a <= s < b:
            return v
    return 80


def en_adelanto(s):
    return any(a <= s <= b - 0.3 for a, b in C["adelantamiento"])


def uf_de(s):
    for u in C["ufs"]:
        if u["desde"] <= s < u["hasta"]:
            return u["id"]
    return C["ufs"][-1]["id"]


def tramos():
    """Tramos de medición (~10 km por UF y sentido)."""
    lista = []
    for u in C["ufs"]:
        n = max(1, round((u["hasta"] - u["desde"]) / 10))
        ancho = (u["hasta"] - u["desde"]) / n
        for i in range(n):
            a, b = round(u["desde"] + i * ancho, 1), round(u["desde"] + (i + 1) * ancho, 1)
            for sentido in "AB":
                lista.append({"id": f"{u['id']}-{sentido}{i + 1}", "uf": u["id"], "sentido": sentido, "desde": a, "hasta": b})
    return lista


TRAMOS = tramos()


def acercar(actual, objetivo, factor):
    return actual + (objetivo - actual) * min(1.0, factor)


def suave(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


class Vehiculo:
    __slots__ = ("id", "cat", "largo", "sentido", "x", "v", "v0", "a", "tag", "destino", "modo", "plazas", "carril",
                 "p", "lat", "adelantando", "cede", "placa", "tag_id", "servicio", "futuro", "pago", "t_cola", "ultima_traza")

    def __init__(self, vid, cat, sentido, x, destino, plazas):
        info = CAT[cat]
        self.id, self.cat, self.sentido, self.x, self.destino = vid, cat, sentido, x, destino
        self.largo = info["largo"]
        self.v0 = random.uniform(*info["v0"]) / 3.6
        self.a = info["acel"]
        self.tag = random.random() < info["tag"]
        self.v = 0.0
        self.modo = "via"
        self.plazas = plazas  # plazas pendientes (en orden de paso)
        self.carril = None
        self.p = 0.0
        self.lat = LAT_VIA
        self.adelantando = None
        self.cede = 0.0
        self.placa = f"{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{random.choice('ABCDEFGHJKLMNPRSTUVWXYZ')}{random.randint(100, 999)}"
        self.tag_id = f"TAG{random.randint(10 ** 9, 10 ** 10 - 1)}" if self.tag else ""
        self.servicio = 0.0
        self.futuro = None
        self.pago = None
        self.t_cola = 0.0
        self.ultima_traza = ""


class Carril:
    def __init__(self, plaza, sentido, indice, tipo):
        self.plaza, self.sentido, self.indice, self.tipo = plaza, sentido, indice, tipo
        self.id = f"{sentido}{indice + 1}"
        self.lat = (1 if sentido == "A" else -1) * (LAT_VIA + 1.2 + indice * ANCHO)
        self.cola = []
        self.salida = []
        self.estado = "abierto"  # abierto | cerrado | contingencia
        self.barrera = 0.0  # 0 cerrada, 1 abierta
        self.barrera_falla = False

    def ocupado(self):
        return sum(v.largo + 2.5 for v in self.cola)


class PlazaSentido:
    def __init__(self, plaza, sentido):
        self.plaza, self.sentido = plaza, sentido
        self.x = x_de(sentido, plaza["s"])
        self.x_abanico = self.x - ABANICO
        self.x_union = self.x + UNION
        self.carriles = [Carril(plaza["id"], sentido, i, t) for i, t in enumerate(C["carriles"])]


class Plaza:
    def __init__(self, datos):
        self.datos = datos
        self.id = datos["id"]
        self.sentidos = {s: PlazaSentido(datos, s) for s in "AB"}
        self.red = 1
        self.ups = 100.0
        self.planta = 0  # 0 en reposo, 1 en marcha, 2 falla de arranque
        self.enlace = 1
        self.modo = "normal"  # normal | contingencia | sin_sistema
        self.pendientes = collections.deque(maxlen=5000)
        self.pasos = collections.deque()  # (t_sim, medio, rechazado)
        self.latencias = collections.deque(maxlen=200)

    def carriles(self):
        for ps in self.sentidos.values():
            yield from ps.carriles


class Unidad:
    """Vehículo de servicio (grúa, ambulancia, inspección, técnicos): se mueve por la berma sin interactuar."""

    def __init__(self, uid, tipo, nombre, base_s):
        self.id, self.tipo, self.nombre = uid, tipo, nombre
        self.base = base_s
        self.s = base_s
        self.destino = None
        self.estado = "en base"
        self.motivo = ""

    def despachar(self, s, motivo):
        self.destino, self.motivo, self.estado = s, motivo, "en ruta"

    def volver(self):
        if self.estado != "en base":
            self.destino, self.estado, self.motivo = self.base, "regresando", ""


class Mundo:
    def __init__(self):
        self.t = time.time()  # reloj de simulación (epoch)
        self.via = {"A": [], "B": []}
        self.plazas = [Plaza(p) for p in C["plazas"]]
        self.plaza_por_id = {p.id: p for p in self.plazas}
        self.sig = 0
        self.ingresos = collections.defaultdict(int)  # vehículos esperando entrar por acceso
        self.llegadas = collections.deque()  # t_sim de ingresos (flujo)
        self.cruces = {t["id"]: collections.deque() for t in TRAMOS}
        self.bitacora = []
        self.previos = set()
        self.marcas = set()
        self.dia = self.fecha()
        self.tx_hoy = 0
        self.recaudo_hoy = 0
        self.tag_hoy = 0
        self.galibo_hoy = 0
        self.galibo_altura = 4.1
        self.dai_alertas = collections.defaultdict(int)
        self.reinicios_gw = 0
        self.ciclo_gw = 0
        self.sincronizando = 0
        self.llamadas = collections.deque()  # (t_real, ms, ok) de las transacciones reales
        self.ultimas = collections.deque(maxlen=40)  # últimas transacciones, para la app de peajes
        self.lluvia = 0.0
        self.its_mudos = set()
        self.unidades = [
            Unidad("grua-pb", "grua", "Grúa Puerto Berrío", C["bases"]["pberrio"]["s"]),
            Unidad("grua-veg", "grua", "Grúa Vegachí", C["bases"]["vegachi"]["s"]),
            Unidad("amb-dol", "ambulancia", "Ambulancia Alto de Dolores", C["bases"]["dolores"]["s"]),
            Unidad("insp-1", "inspeccion", "Inspección vial", C["bases"]["pberrio"]["s"]),
            Unidad("tec-its", "tecnico", "Técnico ITS y telecomunicaciones", C["cco"]["s"]),
            Unidad("tec-elec", "tecnico", "Técnico eléctrico", C["bases"]["vegachi"]["s"]),
            Unidad("tec-peaje", "tecnico", "Técnico de equipos de peaje", C["bases"]["pberrio"]["s"]),
        ]
        self.unidad = {u.id: u for u in self.unidades}
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=16)
        mids = {"A": [], "B": []}
        for t in TRAMOS:
            mid_s = (t["desde"] + t["hasta"]) / 2
            mids[t["sentido"]].append((x_de(t["sentido"], mid_s), t["id"]))
        self.mids = {s: sorted(v) for s, v in mids.items()}

    # ---------- utilidades ----------
    def fecha(self):
        return datetime.fromtimestamp(self.t, BOGOTA).date()

    def hora(self):
        d = datetime.fromtimestamp(self.t, BOGOTA)
        return d.hour + d.minute / 60

    def anotar(self, texto, tipo="info"):
        self.bitacora.append({"t": time.time(), "txt": texto, "tipo": tipo})
        del self.bitacora[:-40]

    def marca(self, clave, condicion, texto, tipo="alerta"):
        if condicion and clave not in self.marcas:
            self.marcas.add(clave)
            self.anotar(texto, tipo)
        elif not condicion:
            self.marcas.discard(clave)

    # ---------- demanda ----------
    def generar(self, dt, activos):
        h = self.hora()
        perfil = PERFIL[int(h) % 24] + (PERFIL[(int(h) + 1) % 24] - PERFIL[int(h) % 24]) * (h % 1)
        demanda = DEMANDA_PICO * perfil * (1.35 if "festivo" in activos else 1.0)
        pobl = C["poblaciones"]
        for sentido in "AB":
            orden = pobl if sentido == "A" else list(reversed(pobl))
            origenes = orden[:-1]
            total = sum(p["peso"] for p in origenes)
            for i, o in enumerate(origenes):
                tasa = demanda * o["peso"] / total / 3600
                if random.random() < tasa * dt:
                    self.ingresos[(o["id"], sentido)] += 1
                clave = (o["id"], sentido)
                if self.ingresos[clave] and self.ingresar(o, orden[i + 1:], sentido, h):
                    self.ingresos[clave] -= 1

    def ingresar(self, origen, destinos, sentido, h):
        x0 = x_de(sentido, origen["s"])
        lista = self.via[sentido]
        for v in lista:
            d = v.x - x0
            if -max(18, v.v * 1.6) < d < 25:
                return False
        noche = h < 5 or h >= 22
        pesos = [w * (1.7 if (noche and k >= 5) else 1) for k, w in zip(CAT_IDS, CAT_PESOS)]
        cat = random.choices(CAT_IDS, pesos)[0]
        destino = random.choices(destinos, [d["peso"] * (1.4 if cat >= 5 and d is destinos[-1] else 1) for d in destinos])[0]
        xd = x_de(sentido, destino["s"])
        plazas = [p for p in self.plazas if x0 < p.sentidos[sentido].x < xd]
        plazas.sort(key=lambda p: p.sentidos[sentido].x)
        self.sig += 1
        v = Vehiculo(self.sig, cat, sentido, x0, xd, plazas)
        v.v = min(v.v0, limite(origen["s"]) / 3.6) * 0.5
        lista.append(v)
        lista.sort(key=lambda u: -u.x)
        self.llegadas.append(self.t)
        return True

    # ---------- vía ----------
    def obstaculos(self, sentido, activos):
        """[(x, motivo)] puntos donde la vía está bloqueada para ese sentido."""
        obs = []
        acc = C["accidente"]
        if "accidente-uf3" in activos and sentido == acc["sentido"]:
            obs.append(x_de(sentido, acc["s"]) - 6)
        return obs

    def v_objetivo(self, v, s, activos):
        lim = limite(s)
        ll = C["lluvia"]
        if self.lluvia > 0 and ll["desde"] <= s <= ll["hasta"]:
            lim *= 1 - 0.48 * self.lluvia
        acc = C["accidente"]
        if "accidente-uf3" in activos and abs(s - acc["s"]) < 0.35:
            lim = min(lim, 25)
        return min(v.v0, lim / 3.6)

    def paso_via(self, dt, activos):
        for sentido in "AB":
            lista = self.via[sentido]
            obs = self.obstaculos(sentido, activos)
            n = len(lista)
            acel = [0.0] * n
            for i, v in enumerate(lista):
                s = s_de(sentido, v.x)
                v0 = max(0.5, self.v_objetivo(v, s, activos))
                lider = lista[i - 1] if i > 0 else None
                if v.adelantando is not None and lider is v.adelantando:
                    lider = lista[i - 2] if i > 1 else None
                gap, dv = 1e9, 0.0
                if lider is not None:
                    gap = lider.x - lider.largo - v.x
                    dv = v.v - lider.v
                # plaza de peaje siguiente: entra al abanico si hay lugar; si no, espera en la vía
                if v.plazas:
                    ps = v.plazas[0].sentidos[sentido]
                    if v.x < ps.x_abanico and ps.x_abanico - v.x < 250 and not self.carril_para(v, ps):
                        g = ps.x_abanico - v.x
                        if g < gap:
                            gap, dv = g, v.v
                for xo in obs:
                    if v.x < xo < v.destino and xo - v.x < gap:
                        gap, dv = xo - v.x, v.v
                gap = max(0.1, gap)
                b = 2.2
                s_star = 3.0 + v.v * 1.4 + v.v * dv / (2 * math.sqrt(v.a * b))
                acel[i] = v.a * (1 - (v.v / v0) ** 4 - (max(0.0, s_star) / gap) ** 2)
                # adelantamiento en zona habilitada
                if (v.adelantando is None and lider is not None and i > 0 and lista[i - 1] is lider and gap < 45
                        and lider.v < v0 - 4 and en_adelanto(s) and en_adelanto(s + 0.4 * (1 if sentido == "A" else -1))):
                    delante = lista[i - 2] if i > 1 else None
                    if delante is None or delante.x - delante.largo - lider.x > v.largo + 40:
                        v.adelantando = lider
            for i, v in enumerate(lista):
                a = max(-9.0, min(v.a, acel[i]))
                v.v = max(0.0, v.v + a * dt)
                v.x += v.v * dt
                if v.adelantando is not None:
                    # el lento se corre al carril de adelantamiento y el rápido pasa por el suyo
                    v.adelantando.cede = 1.0
                    if v.x > v.adelantando.x + v.largo + 6 or v.adelantando.modo != "via":
                        v.adelantando = None
                v.cede = max(0.0, v.cede - dt * 0.5)
                v.lat = acercar(v.lat, LAT_ADELANTO if v.cede > 0 else LAT_VIA, dt * 1.2)
            # sin solapes (salvo el que adelanta)
            lista.sort(key=lambda u: -u.x)
            for i in range(1, len(lista)):
                v, lider = lista[i], lista[i - 1]
                if v.adelantando is None and lider.adelantando is not v and v.x > lider.x - lider.largo - 0.5:
                    v.x = lider.x - lider.largo - 0.5
                    v.v = min(v.v, lider.v)
            # cruces de tramo, transferencias a plaza y llegada a destino
            mids = self.mids[sentido]
            quedan = []
            for v in lista:
                if v.x >= v.destino:
                    continue
                if v.plazas:
                    ps = v.plazas[0].sentidos[sentido]
                    if v.x >= ps.x_abanico:
                        carril = self.carril_para(v, ps)
                        if carril is not None:
                            v.modo, v.carril, v.p = "plaza", carril, ps.x - v.x
                            v.adelantando = None
                            carril.cola.append(v)
                            v.t_cola = self.t
                            continue
                        v.x = ps.x_abanico - 0.1
                        v.v = 0.0
                quedan.append(v)
            self.via[sentido] = quedan
            for v in quedan:
                j = bisect.bisect_right(mids, (v.x, "~"))
                if j > 0:
                    xm, tid = mids[j - 1]
                    if v.x - v.v * dt <= xm < v.x:
                        self.cruces[tid].append(self.t)

    # ---------- plazas ----------
    def carril_para(self, v, ps):
        abiertos = [c for c in ps.carriles if c.estado != "cerrado"]
        if not abiertos:
            return None
        tag = [c for c in abiertos if c.tipo == "TAG"]
        man = [c for c in abiertos if c.tipo == "MAN"]
        candidatos = (tag or man) if v.tag else (man or tag)
        mejor = min(candidatos, key=lambda c: c.ocupado())
        return mejor if mejor.ocupado() + v.largo < ABANICO - 30 else None

    def paso_plazas(self, dt, activos, velocidad):
        for plaza in self.plazas:
            for sentido, ps in plaza.sentidos.items():
                for c in ps.carriles:
                    self.paso_carril(plaza, ps, c, dt, velocidad)

    def paso_carril(self, plaza, ps, c, dt, velocidad):
        objetivo = 0.0
        for i, v in enumerate(c.cola):
            vmax = min(16.0, math.sqrt(max(0.0, 2 * 2.2 * (v.p - objetivo))))
            v.v = min(vmax, v.v + 2.0 * dt) if v.v < vmax else vmax
            v.p = max(objetivo, v.p - v.v * dt)
            sgn = 1 if ps.sentido == "A" else -1
            v.lat = sgn * (LAT_VIA + (abs(c.lat) - LAT_VIA) * suave((ABANICO - v.p) / (ABANICO - 70)))
            objetivo = v.p + v.largo + 2.5
        # servicio en la caseta
        if c.cola:
            v = c.cola[0]
            if v.p <= 0.3 and v.v < 0.6:
                if v.servicio <= 0 and v.futuro is None and v.pago is None:
                    self.iniciar_pago(plaza, c, v)
                v.servicio -= dt
                listo = v.servicio <= 0 and (v.futuro is None or v.futuro.done())
                if v.futuro is not None and v.futuro.done() and v.pago is None:
                    self.cerrar_pago(plaza, c, v)
                    listo = False
                if listo and v.pago is not None and not c.barrera_falla:
                    c.barrera = min(1.0, c.barrera + dt * 1.6 * max(1, velocidad))
                    if c.barrera >= 1:
                        c.cola.pop(0)
                        v.modo, v.p = "salida", 0.0
                        c.salida.append(v)
                        self.registrar_paso(plaza, v)
            elif c.barrera > 0 and not c.salida:
                c.barrera = max(0.0, c.barrera - dt * 1.5)
        elif not c.salida:
            c.barrera = max(0.0, c.barrera - dt * 1.5)
        # salida y regreso a la vía
        lista = self.via[ps.sentido]
        quedan = []
        previo = None
        for v in c.salida:
            v.v = min(16.0, v.v + 1.8 * dt)
            v.p = max(-UNION, v.p - v.v * dt)
            if previo is not None and v.p < previo.p + previo.largo + 3:
                v.p = previo.p + previo.largo + 3
                v.v = min(v.v, previo.v)
            if v.p < -6 and c.barrera > 0 and c.cola and c.cola[0].pago is None:
                c.barrera = max(0.0, c.barrera - dt * 2)
            sgn = 1 if ps.sentido == "A" else -1
            v.lat = sgn * (abs(c.lat) + (LAT_VIA - abs(c.lat)) * suave(-v.p / UNION))
            if v.p <= -UNION:
                if self.unir(lista, v, ps):
                    continue
                v.v = 0.0
            quedan.append(v)
            previo = v
        c.salida = quedan

    def unir(self, lista, v, ps):
        x = ps.x_union
        for u in lista:
            d = u.x - x
            if -max(14, u.v * 1.6) < d < 12 + u.largo:
                return False
        v.modo, v.x, v.carril = "via", x, None
        v.lat = LAT_VIA
        v.v = max(v.v, 6.0)
        v.plazas = v.plazas[1:]
        v.servicio, v.futuro, v.pago = 0.0, None, None
        lista.append(v)
        lista.sort(key=lambda u: -u.x)
        return True

    def iniciar_pago(self, plaza, c, v):
        pesado = 5 if v.cat >= 5 else 0
        if plaza.modo == "sin_sistema":
            v.servicio = random.uniform(38, 55)
            v.pago = {"medio": "efectivo", "contingencia": True, "ok": True}
        elif plaza.modo == "contingencia":
            v.servicio = random.uniform(4, 6) if (c.tipo == "TAG" and v.tag) else random.uniform(16, 26) + pesado
            v.pago = {"medio": "tag" if (c.tipo == "TAG" and v.tag) else "efectivo", "contingencia": True, "ok": True}
        else:
            medio = "tag" if (c.tipo == "TAG" and v.tag) else "efectivo"
            v.servicio = 1.4 if medio == "tag" else random.uniform(14, 24) + pesado
            v.futuro = self.pool.submit(transaccion, plaza.id, f"{c.sentido}{c.indice + 1}", c.sentido, v.cat, medio, v.tag_id, v.placa, False)
        if v.pago is not None and v.pago.get("contingencia"):
            plaza.pendientes.append({"plaza": plaza.id, "carril": c.id, "sentido": c.sentido, "categoria": v.cat,
                                     "medio": v.pago["medio"], "tag_id": v.tag_id, "placa": v.placa})

    def cerrar_pago(self, plaza, c, v):
        r = v.futuro.result()
        self.llamadas.append((time.time(), r["ms"], r["ok"]))
        plaza.latencias.append(r["ms"])
        v.ultima_traza = r.get("trace_id", "")
        if not r["ok"]:
            # sin registro: recibo de contingencia y la transacción queda pendiente de sincronizar
            v.servicio = max(v.servicio, 0) + random.uniform(6, 10)
            v.pago = {"medio": "efectivo", "contingencia": True, "ok": False, "ms": r["ms"], "traza": v.ultima_traza}
            plaza.pendientes.append({"plaza": plaza.id, "carril": c.id, "sentido": c.sentido, "categoria": v.cat,
                                     "medio": "efectivo", "tag_id": v.tag_id, "placa": v.placa})
            return
        if r.get("tag_rechazado"):
            # el TAG no se validó: el operador cobra en efectivo en el mismo carril
            v.servicio = max(v.servicio, 0) + random.uniform(16, 26)
        v.pago = {"medio": r.get("medio", "efectivo"), "valor": r.get("valor", 0), "rechazado": bool(r.get("tag_rechazado")), "ok": True,
                  "ms": r["ms"], "traza": v.ultima_traza}

    def registrar_paso(self, plaza, v):
        pago = v.pago or {}
        valor = int(plaza.datos["tarifas"][str(v.cat)])
        self.tx_hoy += 1
        self.recaudo_hoy += valor
        if pago.get("medio") == "tag":
            self.tag_hoy += 1
        plaza.pasos.append((self.t, pago.get("medio", "efectivo"), bool(pago.get("rechazado"))))
        c = v.carril
        self.ultimas.append({"t": time.time(), "plaza": plaza.id, "carril": c.id if c else "", "placa": v.placa, "cat": v.cat,
                             "medio": pago.get("medio", "efectivo"), "valor": valor, "ms": pago.get("ms"), "ok": bool(pago.get("ok", True)),
                             "rechazado": bool(pago.get("rechazado")), "contingencia": bool(pago.get("contingencia")),
                             "traza": (pago.get("traza") or "")[:16]})
        v.servicio, v.futuro = 0.0, None

    def sincronizar(self):
        """Tras una contingencia, las plazas envían sus transacciones pendientes (también son trazas reales)."""
        if self.sincronizando > 6:
            return
        for plaza in self.plazas:
            if plaza.modo != "normal" or not plaza.pendientes:
                continue
            for _ in range(2):
                if not plaza.pendientes:
                    break
                tx = plaza.pendientes.popleft()
                self.sincronizando += 1
                f = self.pool.submit(transaccion, tx["plaza"], tx["carril"], tx["sentido"], tx["categoria"], tx["medio"],
                                     tx["tag_id"], tx["placa"], True)
                f.add_done_callback(self._sincronizado)

    def _sincronizado(self, f):
        self.sincronizando -= 1

    # ---------- escenarios ----------
    def aplicar_escenarios(self, dt, activos, velocidad, ahora):
        def edad(nombre):  # segundos de simulación desde la activación
            return (ahora - activos[nombre]) * velocidad if nombre in activos else None

        def real(nombre):  # segundos reales: los síntomas nunca llegan en el mismo envío que la causa
            return ahora - activos[nombre] if nombre in activos else None

        for nuevo in set(activos) - self.previos:
            self.anotar(f"Escenario: {estado.CATALOGO[nuevo]}", "escenario")
        for fin in self.previos - set(activos):
            self.anotar(f"Fin del escenario: {estado.CATALOGO[fin]}", "ok")
        if self.previos and not activos:
            self.anotar("Reset: operación normal", "ok")
        self.previos = set(activos)

        veg, pbe = self.plaza_por_id["VEG"], self.plaza_por_id["PBE"]
        # Fibra UF-2: el nodo informa el enlace caído (causa); los ITS de la UF-2 dejan de reportar y Vegachí pierde
        # el enlace con el CCO y pasa a contingencia (síntomas).
        fibra = real("fibra-uf2")
        self.its_mudos = {d["id"] for d in C["its"] if fibra is not None and fibra >= 8 and d["id"] != "nod-uf2"
                          and C["ufs"][1]["desde"] <= d["s"] < C["ufs"][1]["hasta"]}
        # Energía Vegachí: sin red comercial (causa); la planta no arranca, la UPS se descarga y la plaza se apaga.
        energia = edad("energia-vegachi")
        energia_r = real("energia-vegachi")
        veg.red = 0 if energia is not None else 1
        if energia is None:
            veg.ups = min(100.0, veg.ups + dt * 0.25)
            veg.planta = 0
        else:
            veg.ups = max(0.0, veg.ups - dt * 0.42)
            veg.planta = 2 if energia_r >= 10 and energia >= 25 else 1
        veg.enlace = 0 if ((fibra is not None and fibra >= 10) or veg.ups <= 3) else 1
        veg.modo = "sin_sistema" if veg.ups <= 3 else ("contingencia" if not veg.enlace else "normal")
        for c in veg.carriles():
            if veg.modo == "sin_sistema":
                self.cerrar_carril(veg, c, c.indice != 1)
            else:
                self.cerrar_carril(veg, c, False)
                c.estado = "contingencia" if veg.modo == "contingencia" else "abierto"
        # Barrera atascada en Puerto Berrío, sentido A, carril 3
        barrera = "barrera-pbe" in activos
        c3 = pbe.sentidos["A"].carriles[2]
        c3.barrera_falla = barrera
        self.cerrar_carril(pbe, c3, barrera)
        for p in self.plazas:
            if p.modo == "normal":
                for c in p.carriles():
                    if c.estado == "contingencia":
                        c.estado = "abierto"
        # Lluvia en Alto de Dolores
        self.lluvia = acercar(self.lluvia, 1.0 if "lluvia-dolores" in activos else 0.0, dt / 90)
        # Gateway con fuga de memoria
        heap_real = real("gateway-memoria")
        ciclo = int(heap_real // 150) if heap_real is not None else 0
        if heap_real is not None and heap_real % 150 >= 140 and ciclo >= self.ciclo_gw:
            self.reinicios_gw += 1
            self.ciclo_gw = ciclo + 1
            self.anotar("Gateway de recaudo reiniciado por falta de memoria", "alerta")
        if heap_real is None:
            self.ciclo_gw = 0
        # Gálibo
        gal = real("galibo")
        if gal is not None and "galibo" not in self.marcas:
            self.marcas.add("galibo")
            self.galibo_hoy += 1
            self.galibo_altura = 4.92
            self.anotar("Gálibo km 119,9: vehículo de 4,92 m (máx. 4,50 m) antes del puente", "alerta")
        elif gal is None:
            self.marcas.discard("galibo")
            self.galibo_altura = 4.1
        # Unidades de servicio
        self.despachos(activos)

    def cerrar_carril(self, plaza, c, cerrar):
        if cerrar and c.estado != "cerrado":
            c.estado = "cerrado"
            otros = [o for o in plaza.sentidos[c.sentido].carriles if o is not c and o.estado != "cerrado"]
            atendido = c.cola[:1] if (c.cola and c.cola[0].p <= 0.3) else []
            for v in c.cola[len(atendido):]:
                if otros:
                    destino = min(otros, key=lambda o: o.ocupado())
                    v.carril = destino
                    destino.cola.append(v)
            c.cola = atendido
        elif not cerrar and c.estado == "cerrado":
            c.estado = "abierto"

    def despachos(self, activos):
        acc, ll = C["accidente"], C["lluvia"]
        pedidos = {
            "accidente-uf3": [("grua-pb", acc["s"] + 0.05), ("amb-dol", acc["s"] - 0.05), ("insp-1", acc["s"] - 0.4)],
            "fibra-uf2": [("tec-its", 52.4)],
            "energia-vegachi": [("tec-elec", 37.6)],
            "barrera-pbe": [("tec-peaje", 126.4)],
            "lluvia-dolores": [("insp-1", (ll["desde"] + ll["hasta"]) / 2)],
            "galibo": [("insp-1", 119.7)],
        }
        ocupadas = set()
        for esc, lista in pedidos.items():
            if esc not in activos:
                continue
            for uid, s in lista:
                if uid in ocupadas:
                    continue
                ocupadas.add(uid)
                u = self.unidad[uid]
                if u.destino != s and u.estado in ("en base", "regresando"):
                    u.despachar(s, estado.CATALOGO[esc])
                    self.anotar(f"CCO despacha {u.nombre} → km {s:.1f}", "info")
        for u in self.unidades:
            if u.id not in ocupadas:
                u.volver()

    def paso_unidades(self, dt):
        for u in self.unidades:
            if u.destino is None:
                continue
            d = u.destino - u.s
            paso = 75 / 3.6 / 1000 * dt
            if abs(d) <= paso:
                u.s = u.destino
                if u.estado == "en ruta":
                    u.estado = "en sitio"
                    self.anotar(f"{u.nombre} en sitio (km {u.s:.1f})", "ok")
                elif u.estado == "regresando":
                    u.estado, u.destino = "en base", None
            else:
                u.s += math.copysign(paso, d)

    # ---------- paso completo ----------
    def paso(self, dt, activos, velocidad, ahora):
        self.t += dt
        if self.fecha() != self.dia:
            self.dia = self.fecha()
            self.tx_hoy = self.recaudo_hoy = self.tag_hoy = self.galibo_hoy = 0
            self.dai_alertas.clear()
        self.aplicar_escenarios(dt, activos, velocidad, ahora)
        sub = max(1, math.ceil(dt / 0.5))
        for _ in range(sub):
            h = dt / sub
            self.generar(h, activos)
            self.paso_via(h, activos)
            self.paso_plazas(h, activos, velocidad)
        self.paso_unidades(dt)
        self.sincronizar()
        limite_t = self.t - 900
        while self.llegadas and self.llegadas[0] < limite_t:
            self.llegadas.popleft()
        for dq in self.cruces.values():
            while dq and dq[0] < self.t - 600:
                dq.popleft()
        for p in self.plazas:
            while p.pasos and p.pasos[0][0] < self.t - 900:
                p.pasos.popleft()
        while self.llamadas and self.llamadas[0][0] < time.time() - 60:
            self.llamadas.popleft()

    # ---------- medición ----------
    def colas(self):
        """Colas en la vía: grupos de vehículos detenidos con menos de 40 m entre sí. {tramo: km}, {sentido: km}."""
        por_tramo = collections.defaultdict(float)
        maximo = {"A": 0.0, "B": 0.0}
        for sentido, lista in self.via.items():
            i = 0
            while i < len(lista):
                if lista[i].v >= UMBRAL_LENTO:
                    i += 1
                    continue
                j = i
                while j + 1 < len(lista) and lista[j + 1].v < UMBRAL_LENTO and lista[j].x - lista[j].largo - lista[j + 1].x < 40:
                    j += 1
                largo = (lista[i].x - lista[j].x + lista[j].largo) / 1000
                if j > i:
                    # una cola larga se reparte entre los tramos que ocupa
                    for k in range(i, j + 1):
                        tramo = lista[k].x - lista[k + 1].x if k < j else lista[k].largo
                        por_tramo[self.tramo_de(sentido, lista[k].x)] += tramo / 1000
                    maximo[sentido] = max(maximo[sentido], largo)
                i = j + 1
        return por_tramo, maximo

    def tramo_de(self, sentido, x):
        s = s_de(sentido, x)
        for t in TRAMOS:
            if t["sentido"] == sentido and t["desde"] <= s < t["hasta"]:
                return t["id"]
        return TRAMOS[-1]["id"] if sentido == "A" else TRAMOS[0]["id"]

    def medir_tramos(self):
        acum = {t["id"]: [0, 0.0, 0] for t in TRAMOS}
        for sentido, lista in self.via.items():
            for v in lista:
                t = self.tramo_de(sentido, v.x)
                acum[t][2] += 1
                # la velocidad del tramo es la del tránsito en marcha: los que esperan el abanico de un peaje no cuentan
                if any(0 <= p.sentidos[sentido].x_abanico - v.x < 350 for p in self.plazas):
                    continue
                acum[t][0] += 1
                acum[t][1] += v.v * 3.6
        colas, _ = self.colas()
        datos = {}
        for t in TRAMOS:
            n, suma, total = acum[t["id"]]
            largo = t["hasta"] - t["desde"]
            libre = limite((t["desde"] + t["hasta"]) / 2)
            datos[t["id"]] = {
                "velocidad": round(suma / n, 1) if n else float(libre),
                "flujo": len(self.cruces[t["id"]]) * 6,
                "densidad": round(total / largo, 2),
                "cola_km": round(colas.get(t["id"], 0.0), 2),
            }
        return datos

    def latencia_real(self):
        muestras = list(self.llamadas)
        n = len(muestras)
        dur = sorted(m[1] for m in muestras)
        return {"n": n, "p95_ms": round(dur[min(n - 1, int(n * 0.95))]) if n else 0,
                "err_pct": round(sum(not m[2] for m in muestras) / n * 100, 1) if n else 0}

    def kpi(self):
        todos = [v for lista in self.via.values() for v in lista]
        en_plaza = sum(len(c.cola) + len(c.salida) for p in self.plazas for c in p.carriles())
        vel = sum(v.v for v in todos) / len(todos) * 3.6 if todos else 0
        _, colas = self.colas()
        cola_plaza = max((len(c.cola) for p in self.plazas for c in p.carriles()), default=0)
        lat = self.latencia_real()
        return {
            "vehiculos": len(todos) + en_plaza,
            "flujo_h": len(self.llegadas) * 4,
            "velocidad": round(vel, 1),
            "cola_km": round(max(colas.values()), 2),
            "cola_peaje": cola_plaza,
            "transacciones_hoy": self.tx_hoy,
            "recaudo_hoy": self.recaudo_hoy,
            "tag_pct": round(100 * self.tag_hoy / self.tx_hoy, 1) if self.tx_hoy else 0,
            "latencia_ms": lat["p95_ms"],
            "errores_pct": lat["err_pct"],
            "pendientes": sum(len(p.pendientes) for p in self.plazas),
        }


def transaccion(plaza, carril, sentido, categoria, medio, tag_id, placa, contingencia):
    """Transacción real contra peaje-gateway. Devuelve el resultado y la latencia medida."""
    cuerpo = json.dumps({"plaza": plaza, "carril": carril, "sentido": sentido, "categoria": categoria, "medio": medio,
                         "tag_id": tag_id, "placa": placa, "contingencia": contingencia}).encode()
    pedido = urllib.request.Request(f"{GATEWAY}/v1/transacciones", data=cuerpo, headers={"Content-Type": "application/json"})
    inicio = time.monotonic()
    try:
        with urllib.request.urlopen(pedido, timeout=15) as r:
            datos = json.load(r)
        datos["ok"] = bool(datos.get("ok"))
    except urllib.error.HTTPError as e:
        try:
            datos = json.load(e)
        except ValueError:
            datos = {}
        datos["ok"] = False
    except (OSError, ValueError):
        datos = {"ok": False}
    datos["ms"] = round((time.monotonic() - inicio) * 1000)
    return datos


# ---------- Zabbix ----------
def valores(m, activos, ahora):
    r = random.uniform
    lote = []

    def poner(host, datos):
        lote.extend({"host": host, "key": k, "value": v} for k, v in datos.items())

    def edad(nombre):
        return ahora - activos[nombre] if nombre in activos else None

    k = m.kpi()
    tramos_d = m.medir_tramos()
    corredor = {
        "arm.sim.reloj": round(m.t),
        "arm.vehiculos": k["vehiculos"],
        "arm.flujo_h": k["flujo_h"],
        "arm.velocidad_media": k["velocidad"],
        "arm.cola_max_km": k["cola_km"],
    }
    for tid, d in tramos_d.items():
        for campo, valor in d.items():
            corredor[f"arm.tramo.{campo}[{tid}]"] = valor
    poner(H_CORREDOR, corredor)

    for p in m.plazas:
        hora = [x for x in p.pasos if x[0] > m.t - 900]
        tags = [x for x in hora if x[1] == "tag" or x[2]]
        rechazo = round(100 * sum(1 for x in tags if x[2]) / len(tags), 1) if len(tags) >= 3 else 0.0
        lat = sorted(p.latencias)
        datos = {
            "arm.peaje.energia_red": p.red,
            "arm.peaje.ups_bateria": round(p.ups, 1),
            "arm.peaje.ups_autonomia": round(p.ups / 100 * 14, 1),
            "arm.peaje.planta_estado": p.planta,
            "arm.peaje.enlace_cco": p.enlace,
            "arm.peaje.contingencia_pendientes": len(p.pendientes),
            "arm.peaje.carriles_abiertos": sum(1 for c in p.carriles() if c.estado != "cerrado"),
            "arm.peaje.cola_max": max(len(c.cola) for c in p.carriles()),
            "arm.peaje.transacciones_h": len(hora) * 4,
            "arm.peaje.tag_rechazo_pct": rechazo,
            "arm.peaje.latencia_ms": lat[int(len(lat) * 0.95)] if lat else 0,
        }
        p.latencias.clear()
        for c in p.carriles():
            datos[f"arm.carril.estado[{c.id}]"] = {"cerrado": 0, "abierto": 1, "contingencia": 2}[c.estado]
            datos[f"arm.carril.cola[{c.id}]"] = len(c.cola)
            datos[f"arm.carril.barrera[{c.id}]"] = int(c.barrera_falla)
        poner(H_PEAJE[p.id], datos)

    bd = edad("bd-recaudo")
    op = edad("operador-tag")
    heap, _ = heap_gateway(edad("gateway-memoria"))
    pendientes = sum(len(p.pendientes) for p in m.plazas)
    poner(H_PLATAFORMA, {
        "arm.bd.bloqueos": int(r(28, 44)) if bd is not None else int(r(0, 2)),
        "arm.bd.conexiones_pct": round(r(94, 99), 1) if (bd is not None and bd >= 10) else round(r(22, 38), 1),
        "arm.interop.enlace": 0 if op is not None else 1,
        "arm.interop.latencia_ms": round(r(4800, 5200)) if op is not None else round(r(60, 140)),
        "arm.gateway.heap_pct": round(heap + r(-0.6, 0.6), 1),
        "arm.gateway.reinicios": m.reinicios_gw,
        "arm.conciliacion.pendientes": pendientes,
    })

    for d in C["its"]:
        if d["id"] in m.its_mudos:
            continue
        base = {"its.en_linea": 1, "its.latencia_ms": round(r(4, 18), 1), "its.temp_gabinete": round(r(31, 38), 1)}
        t = d["tipo"]
        if t == "nodo":
            caido = d["id"] == "nod-uf2" and "fibra-uf2" in activos
            base.update({"its.enlace_troncal": 0 if caido else 1, "its.trafico_mbps": round(r(2, 5) if caido else r(180, 320), 1)})
        elif t == "dai":
            detenidos = 2 if (d["id"] == "dai-k099" and "accidente-uf3" in activos) else 0
            if detenidos and random.random() < 0.3:
                m.dai_alertas[d["id"]] += 1
            base.update({"its.detenidos": detenidos, "its.alertas_hoy": m.dai_alertas[d["id"]], "its.fps": round(r(24, 25), 1)})
        elif t == "radar":
            tramo = tramos_d[m.tramo_de("A", x_de("A", d["s"]))]
            base.update({"its.vel_media": tramo["velocidad"], "its.vehiculos_h": tramo["flujo"]})
        elif t == "pmv":
            base.update({"its.mensaje": mensaje_pmv(d, activos, m), "its.brillo_pct": round(r(70, 80) if 6 <= m.hora() < 18 else r(35, 45))})
        elif t == "meteo":
            lluvia = m.lluvia if d["id"] == "met-k071" else 0.0
            base.update({"its.precipitacion": round(lluvia * r(32, 40) + r(0, 0.4), 1),
                         "its.visibilidad": round(max(90, 4000 * (1 - lluvia) ** 2 + r(-50, 50) + (0 if lluvia > 0.5 else 0))),
                         "its.temperatura": round(r(21, 23) if d["id"] == "met-k071" else r(29, 32), 1),
                         "its.humedad": round(min(100, 72 + lluvia * 26 + r(-2, 2)), 1)})
        elif t == "galibo":
            base.update({"its.detecciones_hoy": m.galibo_hoy, "its.altura_m": m.galibo_altura})
        poner(h_its(d["id"]), base)
    return lote


def heap_gateway(edad_seg):
    if edad_seg is None:
        return 46.0, False
    fase = edad_seg % 150
    if fase >= 140:
        return 18.0, True
    return min(99.0, 52 + fase * 0.34), False


def mensaje_pmv(d, activos, m):
    if d["id"] == "pmv-k092" and "accidente-uf3" in activos:
        return "ACCIDENTE KM 100 · CARRIL CERRADO · PRECAUCIÓN"
    if d["id"] == "pmv-k064" and m.lluvia > 0.2:
        return "LLUVIA FUERTE · REDUZCA LA VELOCIDAD · 40 KM/H"
    if d["id"] == "pmv-k030" and m.plaza_por_id["VEG"].modo != "normal":
        return "PEAJE VEGACHÍ EN CONTINGENCIA · PREVEA DEMORAS"
    if d["id"] == "pmv-k092" and "barrera-pbe" in activos:
        return "PEAJE PTO. BERRÍO · CARRIL CERRADO · PREVEA DEMORAS"
    return "VIAJE SEGURO · USE EL CINTURÓN"


def problemas_ensayo(m, activos):
    """Problemas de mentira para ensayar la escena sin Zabbix. Con Zabbix conectado no se usan."""
    lista = []

    def p(nombre, sev, causa=False):
        lista.append({"nombre": nombre, "severidad": sev, "causa": causa})

    nombres = {
        "fibra-uf2": ("Nodo de fibra UF-2: enlace troncal caído", 4),
        "energia-vegachi": ("Peaje Vegachí: sin energía de la red", 4),
        "bd-recaudo": ("BD de recaudo: sesiones bloqueadas", 4),
        "operador-tag": ("Interoperabilidad TAG: operador sin respuesta", 4),
        "gateway-memoria": ("Gateway de recaudo: memoria heap alta", 3),
        "accidente-uf3": ("Cámara DAI km 99: vehículo detenido en calzada", 4),
        "lluvia-dolores": ("Alto de Dolores: precipitación intensa", 3),
        "barrera-pbe": ("Peaje Puerto Berrío: barrera en falla carril A3", 3),
        "galibo": ("Gálibo km 119,9: vehículo sobredimensionado", 3),
    }
    for esc, (nombre, sev) in nombres.items():
        if esc in activos:
            p(nombre, sev, True)
    k = m.kpi()
    if k["cola_km"] > 0.4:
        p(f"Cola en la vía de {k['cola_km']:.1f} km", 3)
    if k["cola_peaje"] > UMBRAL_COLA_PLAZA:
        p("Cola en plaza de peaje", 3)
    for pl in m.plazas:
        if pl.modo != "normal":
            p(f"{pl.datos['nombre']} en contingencia", 3)
    return lista


def foto(m, activos, velocidad, ahora):
    vehiculos = []
    for sentido, lista in m.via.items():
        for v in lista:
            sgn = 1 if sentido == "A" else -1
            vehiculos.append([v.id, round(s_de(sentido, v.x), 4), round(v.lat * sgn, 1), round(v.v * sgn, 1), v.cat, 0])
    for p in m.plazas:
        for c in p.carriles():
            sgn = 1 if c.sentido == "A" else -1
            for v in c.cola:
                vehiculos.append([v.id, round(p.datos["s"] - sgn * v.p / 1000, 4), round(v.lat, 1), round(v.v * sgn, 1), v.cat, 1])
            for v in c.salida:
                vehiculos.append([v.id, round(p.datos["s"] - sgn * v.p / 1000, 4), round(v.lat, 1), round(v.v * sgn, 1), v.cat, 2])
    return {
        "ts": ahora,
        "t_sim": m.t,
        "velocidad": velocidad,
        "activos": sorted(activos),
        "kpi": m.kpi(),
        "vehiculos": vehiculos,
        "plazas": [{
            "id": p.id, "nombre": p.datos["nombre"], "modo": p.modo, "red": p.red, "ups": round(p.ups), "planta": p.planta,
            "enlace": p.enlace, "pendientes": len(p.pendientes),
            "carriles": [{"id": c.id, "tipo": c.tipo, "estado": c.estado, "cola": len(c.cola), "barrera": round(c.barrera, 2),
                          "falla": c.barrera_falla, "caseta": c.cola[0].placa if c.cola and c.cola[0].p <= 0.3 else "",
                          "cat": c.cola[0].cat if c.cola and c.cola[0].p <= 0.3 else 0} for c in p.carriles()],
        } for p in m.plazas],
        "its": [{"id": d["id"], "ok": d["id"] not in m.its_mudos and not (d["id"] == "nod-uf2" and "fibra-uf2" in activos),
                 "alerta": (d["id"] == "dai-k099" and "accidente-uf3" in activos) or (d["id"] == "met-k071" and m.lluvia > 0.3)
                 or (d["id"] == "gal-k120" and "galibo" in activos),
                 **({"mensaje": mensaje_pmv(d, activos, m)} if d["tipo"] == "pmv" else {})} for d in C["its"]],
        "unidades": [{"id": u.id, "tipo": u.tipo, "nombre": u.nombre, "s": round(u.s, 3), "estado": u.estado} for u in m.unidades],
        "lluvia": round(m.lluvia, 2),
        "accidente": "accidente-uf3" in activos,
        "galibo": "galibo" in activos,
        "bitacora": m.bitacora,
        "transacciones": list(m.ultimas)[-25:],
        "problemas_ensayo": problemas_ensayo(m, activos),
    }


def main():
    m = Mundo()
    sender = ZabbixSender(TRAPPER_HOST, TRAPPER_PORT) if TRAPPER_HOST else None
    print(f"Simulador en marcha; trapper {'hacia ' + TRAPPER_HOST if sender else 'desactivado (ensayo)'}", flush=True)
    # precalentamiento: 75 minutos de tránsito para que la vía no arranque vacía (sin transacciones reales)
    m.t = time.time() - 75 * 60
    original = m.pool.submit
    m.pool.submit = lambda *a, **k: _resuelto()
    for _ in range(75 * 60):
        m.paso(1.0, {}, 1, time.time())
    m.pool.submit = original
    for p in m.plazas:
        p.pendientes.clear()
        p.latencias.clear()
    m.llamadas.clear()
    m.ultimas.clear()
    m.tx_hoy = m.recaudo_hoy = m.tag_hoy = 0
    m.bitacora.clear()
    m.anotar("Simulador listo: corredor de 153 km en operación", "ok")
    print(f"precalentamiento listo: {m.kpi()['vehiculos']} vehículos en el corredor", flush=True)

    proximo_envio = proximo_foto = 0.0
    previo = time.time()
    activos_previos = set()
    while True:
        ahora = time.time()
        crudo = min(1.0, ahora - previo)
        previo = ahora
        esc = estado.escenarios()
        activos, velocidad = esc["activos"], esc["velocidad"]
        m.paso(crudo * velocidad, activos, velocidad, ahora)
        nuevos = set(activos) - activos_previos
        activos_previos = set(activos)
        if ahora >= proximo_foto:
            proximo_foto = ahora + FOTO_SEG
            estado.escribir(estado.MUNDO, foto(m, activos, velocidad, ahora))
        # un escenario nuevo envía su causa enseguida, antes que cualquier síntoma
        if sender and (ahora >= proximo_envio or nuevos):
            proximo_envio = ahora + ENVIO_SEG
            try:
                ok, info = sender.send_batch(valores(m, activos, ahora))
                if not ok:
                    print(f"!! trapper: {info}", flush=True)
            except OSError as e:
                print(f"!! trapper: {e}", flush=True)
        time.sleep(max(0.0, TICK_SEG - (time.time() - ahora)))


def _resuelto():
    f = concurrent.futures.Future()
    f.set_result({"ok": True, "ms": 120, "medio": "tag", "valor": 0})
    return f


if __name__ == "__main__":
    main()
