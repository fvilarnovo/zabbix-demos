#!/usr/bin/env python3
"""Genera provision/export/{templates,hosts,dashboards}_autopista.yaml (formato Zabbix 8.0) desde el modelo del corredor.

Las otras demos exportan su configuración desde un Zabbix donde ya existe (comun/exportar_zabbix.py). Esta la genera
desde web/static/corredor.json para que las claves de los ítems sean exactamente las que envía sim/simulador.py.
Los UUID son deterministas: regenerar actualiza sin duplicar. Uso (solo biblioteca estándar):

    python3 herramientas/generar_export.py

Tags de los triggers (los usan las reglas CEP de provision/post_provision.py):
    demo=autopista · zona=UF1..UF4|central (agrupa causa y síntomas) · rol=causa|sintoma|control
    nivel=ot|its|red|infra|apm · problema=<tipo> · recurso=<equipo> · recaudo=si (afecta la plataforma de recaudo)
"""
import hashlib
import json
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent
C = json.loads((RAIZ / "web" / "static" / "corredor.json").read_text(encoding="utf-8"))
SALIDA = RAIZ / "provision" / "export"

GRUPO_T = "Templates/Autopista"
G_CORREDOR, G_PEAJES, G_ITS, G_RECAUDO, G_APM = "Autopista/Corredor", "Autopista/Peajes", "Autopista/ITS", "Autopista/Recaudo", "Autopista/APM"
T_CORREDOR = "Autopista Corredor"
T_PEAJE = "Autopista OT Peaje"
T_PLATAFORMA = "Autopista Plataforma recaudo"
T_APM = "Autopista APM by Telemetry query"
T_KPI = "Autopista KPIs by ClickHouse"
T_ITS = {"nodo": "Autopista ITS Nodo de fibra", "dai": "Autopista ITS Camara DAI", "radar": "Autopista ITS Radar",
         "pmv": "Autopista ITS PMV", "meteo": "Autopista ITS Estacion meteorologica", "galibo": "Autopista ITS Galibo"}
H_CORREDOR = "Autopista - Corredor"
H_PLATAFORMA = "Autopista - Plataforma de recaudo"
H_RECAUDO = "Autopista - Recaudo"
H_DISCOVERY = "Autopista - APM discovery"
PEAJES = {"VEG": ("Autopista - Peaje Vegachi", "Autopista - Peaje Vegachí"),
          "SIS": ("Autopista - Peaje Santa Isabel", "Autopista - Peaje Santa Isabel"),
          "PBE": ("Autopista - Peaje Puerto Berrio", "Autopista - Peaje Puerto Berrío")}
ZONA = "{$ARM.ZONA}"
TRAPPER = "{$TRAPPER.ALLOWED_HOSTS}"


def uuid(semilla):
    h = list(hashlib.md5(f"autopista:{semilla}".encode()).hexdigest())
    h[12] = "4"
    h[16] = "89ab"[int(h[16], 16) % 4]
    return "".join(h)


def uf_de(s):
    for u in C["ufs"]:
        if u["desde"] <= s < u["hasta"]:
            return u["id"]
    return C["ufs"][-1]["id"]


def tags(**kw):
    return [{"tag": k, "value": str(v)} for k, v in kw.items() if v is not None]


def ttags(zona, rol, nivel, problema, recurso=None, recaudo=False):
    lista = tags(demo="autopista", zona=zona, rol=rol, nivel=nivel, problema=problema, recurso=recurso)
    if recaudo:
        lista.append({"tag": "recaudo", "value": "si"})
    return lista


def trap(tpl, key, nombre, componente, value_type="FLOAT", units=None, valuemap=None, triggers=(), descripcion=None):
    it = {"uuid": uuid(f"{tpl}:{key}"), "name": nombre, "type": "TRAP", "key": key}
    if value_type != "UNSIGNED":
        it["value_type"] = value_type
    it["allowed_hosts"] = TRAPPER
    if units:
        it["units"] = units
    if descripcion:
        it["description"] = descripcion
    if valuemap:
        it["valuemap"] = {"name": valuemap}
    it["tags"] = tags(component=componente)
    if triggers:
        it["triggers"] = [trig(tpl, **t) for t in triggers]
    return it


def trig(tpl, expr, nombre, prioridad, tags_, descripcion=None, manual_close=False):
    t = {"uuid": uuid(f"{tpl}:t:{nombre}:{expr}"), "expression": expr, "name": nombre, "priority": prioridad}
    if descripcion:
        t["description"] = descripcion
    if manual_close:
        t["manual_close"] = "YES"
    t["tags"] = tags_
    return t


def vmap(tpl, nombre, pares):
    return {"uuid": uuid(f"{tpl}:vm:{nombre}"), "name": nombre,
            "mappings": [{"value": str(v), "newvalue": n} for v, n in pares]}


def template(nombre, descripcion, items, macros=(), valuemaps=(), tags_=None):
    t = {"uuid": uuid(f"tpl:{nombre}"), "template": nombre, "name": nombre, "description": descripcion,
         "groups": [{"name": GRUPO_T}], "items": items, "tags": tags_ or tags(demo="autopista")}
    if macros:
        t["macros"] = [{"macro": m, "value": v, **({"description": d} if d else {})} for m, v, d in macros]
    if valuemaps:
        t["valuemaps"] = list(valuemaps)
    return t


# ---------------------------------------------------------------- corredor
def tramos():
    lista = []
    for u in C["ufs"]:
        n = max(1, round((u["hasta"] - u["desde"]) / 10))
        ancho = (u["hasta"] - u["desde"]) / n
        for i in range(n):
            a, b = round(u["desde"] + i * ancho, 1), round(u["desde"] + (i + 1) * ancho, 1)
            for sentido in "AB":
                lista.append({"id": f"{u['id']}-{sentido}{i + 1}", "uf": u["id"], "sentido": sentido, "desde": a, "hasta": b,
                              "nombre": f"{u['id'].replace('UF', 'UF-')} km {a:.0f}-{b:.0f} {C['sentidos'][sentido]['corto']}"})
    return lista


TRAMOS = tramos()


def t_corredor():
    T = T_CORREDOR
    ref = lambda k: f"/{T}/{k}"  # noqa: E731
    items = [
        trap(T, "arm.sim.reloj", "Corredor: reloj de la simulación", "general", units="unixtime", triggers=[
            {"expr": f"nodata({ref('arm.sim.reloj')},2m)=1", "nombre": "Corredor: la simulación dejó de enviar datos", "prioridad": "AVERAGE",
             "tags_": ttags("central", "causa", "ot", "simulador_sin_datos", "simulador")}]),
        trap(T, "arm.vehiculos", "Corredor: vehículos en el corredor", "transito", "UNSIGNED"),
        trap(T, "arm.flujo_h", "Corredor: flujo de ingreso", "transito", "UNSIGNED", units="veh/h"),
        trap(T, "arm.velocidad_media", "Corredor: velocidad media", "transito", units="km/h"),
        trap(T, "arm.cola_max_km", "Corredor: cola máxima en la vía", "transito", units="km"),
    ]
    for z in ["UF1", "UF2", "UF3", "UF4", "central"]:
        k = f"arm.cep.reinicio[{z}]"
        items.append(trap(T, k, f"Control: reinicio de ventana CEP {z}", "control", "UNSIGNED", triggers=[
            {"expr": f"last({ref(k)})=1", "nombre": f"Control: reinicio de ventana CEP {z}", "prioridad": "NOT_CLASSIFIED",
             "tags_": tags(demo="autopista", zona=z, rol="control", recurso="reinicio")}]))
    for t in TRAMOS:
        n, i = t["nombre"], t["id"]
        kv, kc = f"arm.tramo.velocidad[{i}]", f"arm.tramo.cola_km[{i}]"
        items += [
            trap(T, kv, f"Tramo {n}: velocidad media", "transito", units="km/h", triggers=[
                {"expr": f"max({ref(kv)},3m)<{{$ARM.VEL.MIN}}", "nombre": f"Tramo {n}: velocidad media baja ({{ITEM.LASTVALUE}})",
                 "prioridad": "AVERAGE", "tags_": ttags(t["uf"], "sintoma", "ot", "velocidad_baja", f"tramo-{i}")}]),
            trap(T, f"arm.tramo.flujo[{i}]", f"Tramo {n}: flujo", "transito", "UNSIGNED", units="veh/h"),
            trap(T, f"arm.tramo.densidad[{i}]", f"Tramo {n}: densidad", "transito", units="veh/km"),
            trap(T, kc, f"Tramo {n}: cola", "transito", units="km", triggers=[
                {"expr": f"min({ref(kc)},2m)>{{$ARM.COLA.MAX}}", "nombre": f"Tramo {n}: cola en la vía ({{ITEM.LASTVALUE}})",
                 "prioridad": "HIGH", "tags_": ttags(t["uf"], "sintoma", "ot", "cola_vial", f"tramo-{i}")}]),
        ]
    return template(T, "Corredor de la autopista demo: tránsito por tramo (~10 km por UF y sentido), datos por trapper.", items, macros=[
        ("{$ARM.VEL.MIN}", "35", "Velocidad media mínima del tramo (km/h) durante 3 min."),
        ("{$ARM.COLA.MAX}", "0.4", "Cola máxima en un tramo (km) durante 2 min."),
    ])


# ---------------------------------------------------------------- peajes
def t_peaje():
    T = T_PEAJE
    ref = lambda k: f"/{T}/{k}"  # noqa: E731
    z = ZONA
    items = [
        trap(T, "arm.peaje.energia_red", "Peaje: energía de la red comercial", "energia", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
            {"expr": f"last({ref('arm.peaje.energia_red')})=0", "nombre": "{HOST.NAME}: sin energía de la red comercial", "prioridad": "HIGH",
             "tags_": ttags(z, "causa", "ot", "sin_energia", "energia")}]),
        trap(T, "arm.peaje.planta_estado", "Peaje: planta de emergencia", "energia", "UNSIGNED", valuemap="Autopista planta", triggers=[
            {"expr": f"last({ref('arm.peaje.planta_estado')})=2", "nombre": "{HOST.NAME}: la planta de emergencia no arrancó", "prioridad": "HIGH",
             "tags_": ttags(z, "sintoma", "ot", "planta_emergencia", "energia")}]),
        trap(T, "arm.peaje.ups_bateria", "Peaje: UPS carga de batería", "energia", units="%", triggers=[
            {"expr": f"last({ref('arm.peaje.ups_bateria')})<{{$ARM.UPS.MIN}}", "nombre": "{HOST.NAME}: UPS con batería baja ({ITEM.LASTVALUE})", "prioridad": "HIGH",
             "tags_": ttags(z, "sintoma", "ot", "ups_baja", "ups")}]),
        trap(T, "arm.peaje.ups_autonomia", "Peaje: UPS autonomía", "energia", units="min"),
        trap(T, "arm.peaje.enlace_cco", "Peaje: enlace con el CCO", "red", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
            {"expr": f"last({ref('arm.peaje.enlace_cco')})=0", "nombre": "{HOST.NAME}: sin enlace con el CCO (opera en contingencia)", "prioridad": "AVERAGE",
             "tags_": ttags(z, "sintoma", "red", "sin_enlace", "enlace")}]),
        trap(T, "arm.peaje.contingencia_pendientes", "Peaje: transacciones en contingencia sin sincronizar", "recaudo", "UNSIGNED", triggers=[
            {"expr": f"min({ref('arm.peaje.contingencia_pendientes')},1m)>{{$ARM.PENDIENTES.MAX}}", "nombre": "{HOST.NAME}: transacciones en contingencia sin sincronizar ({ITEM.LASTVALUE})",
             "prioridad": "AVERAGE", "tags_": ttags(z, "sintoma", "ot", "contingencia", "recaudo")}]),
        trap(T, "arm.peaje.carriles_abiertos", "Peaje: carriles abiertos", "carriles", "UNSIGNED", triggers=[
            {"expr": f"last({ref('arm.peaje.carriles_abiertos')})<{{$ARM.CARRILES.MIN}}", "nombre": "{HOST.NAME}: carriles cerrados (abiertos: {ITEM.LASTVALUE})",
             "prioridad": "AVERAGE", "tags_": ttags(z, "sintoma", "ot", "carriles_cerrados", "carriles")}]),
        trap(T, "arm.peaje.cola_max", "Peaje: cola máxima en carril", "carriles", "UNSIGNED", units="veh", triggers=[
            {"expr": f"min({ref('arm.peaje.cola_max')},2m)>{{$ARM.COLA.PLAZA}}", "nombre": "{HOST.NAME}: cola en la plaza ({ITEM.LASTVALUE})",
             "prioridad": "AVERAGE", "tags_": ttags(z, "sintoma", "ot", "cola_peaje", "plaza", recaudo=True)}]),
        trap(T, "arm.peaje.transacciones_h", "Peaje: transacciones por hora", "recaudo", "UNSIGNED", units="tx/h"),
        trap(T, "arm.peaje.tag_rechazo_pct", "Peaje: TAG rechazados", "recaudo", units="%", triggers=[
            {"expr": f"last({ref('arm.peaje.tag_rechazo_pct')})>{{$ARM.TAG.RECHAZO}}", "nombre": "{HOST.NAME}: TAG rechazados, cobro manual en carril TAG ({ITEM.LASTVALUE})",
             "prioridad": "AVERAGE", "tags_": ttags(z, "sintoma", "ot", "tag_rechazado", "carril-tag", recaudo=True)}]),
        trap(T, "arm.peaje.latencia_ms", "Peaje: latencia p95 de autorización", "recaudo", units="ms"),
    ]
    for sentido in "AB":
        for i, tipo in enumerate(C["carriles"]):
            cid = f"{sentido}{i + 1}"
            nombre = f"Carril {cid} ({tipo})"
            kb = f"arm.carril.barrera[{cid}]"
            items += [
                trap(T, f"arm.carril.estado[{cid}]", f"{nombre}: estado", "carriles", "UNSIGNED", valuemap="Autopista carril"),
                trap(T, f"arm.carril.cola[{cid}]", f"{nombre}: cola", "carriles", "UNSIGNED", units="veh"),
                trap(T, kb, f"{nombre}: barrera en falla", "carriles", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
                    {"expr": f"last({ref(kb)})=1", "nombre": f"{{HOST.NAME}}: barrera en falla en el carril {cid}", "prioridad": "HIGH",
                     "tags_": ttags(z, "causa", "ot", "barrera_falla", f"carril-{cid}")}]),
            ]
    return template(T, "Plaza de peaje: energía, enlace, carriles, barreras y colas. Datos por trapper del simulador.", items, macros=[
        ("{$ARM.ZONA}", "sin_zona", "UF de la plaza (tag zona para el CEP). Se define en cada host."),
        ("{$ARM.UPS.MIN}", "30", "Carga mínima de la UPS (%)."),
        ("{$ARM.PENDIENTES.MAX}", "5", "Transacciones en contingencia sin sincronizar durante 1 min."),
        ("{$ARM.CARRILES.MIN}", "6", "Carriles que deben estar abiertos."),
        ("{$ARM.COLA.PLAZA}", "8", "Cola máxima en un carril (vehículos) durante 2 min."),
        ("{$ARM.TAG.RECHAZO}", "20", "TAG rechazados en 15 min (%)."),
    ], valuemaps=[
        vmap(T, "Autopista sí/no", [(0, "No"), (1, "Sí")]),
        vmap(T, "Autopista planta", [(0, "En reposo"), (1, "En marcha"), (2, "Falla de arranque")]),
        vmap(T, "Autopista carril", [(0, "Cerrado"), (1, "Abierto"), (2, "Contingencia")]),
    ])


# ---------------------------------------------------------------- plataforma de recaudo (infraestructura)
def t_plataforma():
    T = T_PLATAFORMA
    ref = lambda k: f"/{T}/{k}"  # noqa: E731
    items = [
        trap(T, "arm.bd.bloqueos", "BD recaudo: sesiones bloqueadas", "bd", "UNSIGNED", triggers=[
            {"expr": f"last({ref('arm.bd.bloqueos')})>{{$ARM.BD.BLOQUEOS}}", "nombre": "BD de recaudo: sesiones bloqueadas ({ITEM.LASTVALUE})", "prioridad": "HIGH",
             "tags_": ttags("central", "causa", "infra", "bd_bloqueos", "bd-recaudo", recaudo=True)}]),
        trap(T, "arm.bd.conexiones_pct", "BD recaudo: uso del pool de conexiones", "bd", units="%", triggers=[
            {"expr": f"last({ref('arm.bd.conexiones_pct')})>90", "nombre": "BD de recaudo: pool de conexiones saturado ({ITEM.LASTVALUE})", "prioridad": "AVERAGE",
             "tags_": ttags("central", "sintoma", "infra", "pool_saturado", "bd-recaudo", recaudo=True)}]),
        trap(T, "arm.interop.enlace", "Interoperabilidad TAG: enlace con el operador", "interoperabilidad", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
            {"expr": f"last({ref('arm.interop.enlace')})=0", "nombre": "Interoperabilidad TAG: el operador externo no responde", "prioridad": "HIGH",
             "tags_": ttags("central", "causa", "infra", "operador_tag", "operador-tag", recaudo=True)}]),
        trap(T, "arm.interop.latencia_ms", "Interoperabilidad TAG: latencia del operador", "interoperabilidad", units="ms"),
        trap(T, "arm.gateway.heap_pct", "Gateway de recaudo: memoria heap", "gateway", units="%", triggers=[
            {"expr": f"last({ref('arm.gateway.heap_pct')})>{{$ARM.HEAP.MAX}}", "nombre": "Gateway de recaudo: memoria heap alta ({ITEM.LASTVALUE})", "prioridad": "AVERAGE",
             "tags_": ttags("central", "causa", "infra", "heap_gateway", "peaje-gateway", recaudo=True)}]),
        trap(T, "arm.gateway.reinicios", "Gateway de recaudo: reinicios", "gateway", "UNSIGNED", triggers=[
            {"expr": f"change({ref('arm.gateway.reinicios')})>0", "nombre": "Gateway de recaudo: reinicio por falta de memoria", "prioridad": "HIGH",
             "tags_": ttags("central", "sintoma", "infra", "reinicio_gateway", "peaje-gateway", recaudo=True)}]),
        trap(T, "arm.conciliacion.pendientes", "Conciliación: transacciones pendientes de las plazas", "conciliacion", "UNSIGNED", triggers=[
            {"expr": f"min({ref('arm.conciliacion.pendientes')},2m)>50", "nombre": "Conciliación: transacciones de plaza sin conciliar ({ITEM.LASTVALUE})", "prioridad": "WARNING",
             "tags_": ttags("central", "sintoma", "infra", "conciliacion", "conciliacion", recaudo=True)}]),
    ]
    return template(T, "Infraestructura de la app de recaudo (base de datos, gateway, interoperabilidad TAG, conciliación).", items, macros=[
        ("{$ARM.BD.BLOQUEOS}", "10", "Sesiones bloqueadas en la base de recaudo."),
        ("{$ARM.HEAP.MAX}", "85", "Uso de heap del gateway (%)."),
    ], valuemaps=[vmap(T, "Autopista sí/no", [(0, "No"), (1, "Sí")])])


# ---------------------------------------------------------------- APM (Telemetry query) y KPI (ClickHouse)
def tq(tpl, key, nombre, servicio, span, agregado, units=None, error=False, triggers=()):
    if agregado == "p95":
        cols = [{"function": "PERCENTILE", "column": "Duration", "parameters": ["95"], "alias": "p95"}]
        pre = [{"type": "JSONPATH", "parameters": ["$[0].p95"], "error_handler": "CUSTOM_VALUE", "error_handler_params": "0"},
               {"type": "MULTIPLIER", "parameters": ["1.0E-9"]}]
    else:
        cols = [{"alias": agregado}]
        pre = [{"type": "JSONPATH", "parameters": [f"$[0].{agregado}"], "error_handler": "CUSTOM_VALUE", "error_handler_params": "0"}]
    cond = [{"column": "ResourceAttributes", "attribute_key": "service.namespace", "value": "{$ARM.NS}"},
            {"column": "ServiceName", "value": servicio}, {"column": "SpanKind", "value": "Server"}, {"column": "SpanName", "value": span}]
    if error:
        cond.append({"column": "StatusCode", "value": "Error"})
    it = {"uuid": uuid(f"{tpl}:{key}"), "name": nombre, "type": "TELEMETRY_QUERY", "key": key, "delay": "30s", "value_type": "FLOAT"}
    if units:
        it["units"] = units
    it.update({"preprocessing": pre, "timeout": "5s", "time_shift": "15s", "lookback_limit": "1m", "granularity": "1m",
               "query": {"columns": [{"column": "ServiceName"}], "aggregated_columns": cols, "filter": {"conditions": cond}},
               "tags": tags(component="apm", servicio=servicio)})
    if triggers:
        it["triggers"] = [trig(tpl, **t) for t in triggers]
    return it


def t_apm():
    T = T_APM
    ref = lambda k: f"/{T}/{k}"  # noqa: E731
    servicios = [
        ("gateway", "peaje-gateway", "POST /v1/transacciones", "Gateway", 2.0, 5),
        ("validacion", "validacion-tag", "POST /validar", "Validación TAG", 2.0, 20),
        ("transacciones", "transacciones", "POST /registrar", "Registro de transacciones", 1.0, 10),
        ("operador", "operador-tag", "POST /autorizar", "Operador TAG", 2.5, 20),
    ]
    items = []
    for clave, servicio, span, titulo, p95_max, err_max in servicios:
        base = f"arm.apm.{clave}"
        mp, me = f"{{$ARM.{clave.upper()}.P95.MAX}}", f"{{$ARM.{clave.upper()}.ERROR.MAX}}"
        items += [
            tq(T, f"{base}.p95", f"APM {titulo}: p95", servicio, span, "p95", units="s", triggers=[
                {"expr": f"last({ref(base + '.p95')})>{mp}", "nombre": f"APM {titulo}: latencia p95 alta ({{ITEM.LASTVALUE}})", "prioridad": "AVERAGE",
                 "tags_": ttags("central", "sintoma", "apm", "latencia_apm", servicio, recaudo=True)}]),
            tq(T, f"{base}.total", f"APM {titulo}: solicitudes por minuto", servicio, span, "total"),
            tq(T, f"{base}.errores", f"APM {titulo}: errores por minuto", servicio, span, "errores", error=True),
            {"uuid": uuid(f"{T}:{base}.error_pct"), "name": f"APM {titulo}: tasa de errores", "type": "CALCULATED", "key": f"{base}.error_pct",
             "delay": "30s", "value_type": "FLOAT", "units": "%", "params": f"100*last(//{base}.errores)/max(last(//{base}.total),1)",
             "tags": tags(component="apm", servicio=servicio),
             "triggers": [trig(T, f"last({ref(base + '.error_pct')})>{me} and last({ref(base + '.total')})>=3",
                               f"APM {titulo}: tasa de errores alta ({{ITEM.LASTVALUE}})", "HIGH",
                               ttags("central", "sintoma", "apm", "errores_apm", servicio, recaudo=True))]},
        ]
    macros = [("{$ARM.NS}", "autopista", "service.namespace de las trazas.")]
    for clave, _, _, _, p95_max, err_max in servicios:
        macros += [(f"{{$ARM.{clave.upper()}.P95.MAX}}", str(p95_max), "Latencia p95 máxima (s)."),
                   (f"{{$ARM.{clave.upper()}.ERROR.MAX}}", str(err_max), "Tasa de errores máxima (%).")]
    return template(T, "Latencia y errores de la app de recaudo de peajes, con ítems Telemetry query de Zabbix 8.0 sobre las trazas OpenTelemetry.", items, macros=macros)


SQL_KPI = """
WITH
    toDate(Timestamp, 'America/Bogota') = toDate(now(), 'America/Bogota') AS hoy,
    Timestamp > now() - toIntervalMinute(15) AS ult_15m,
    Timestamp > now() - toIntervalMinute(60) AS ult_1h,
    ServiceName = 'peaje-gateway' AND SpanName = 'POST /v1/transacciones' AS es_tx,
    StatusCode = 'Error' AS fallo,
    toUInt64OrZero(SpanAttributes['peaje.valor']) AS valor,
    SpanAttributes['peaje.plaza'] AS plaza,
    SpanAttributes['peaje.medio'] = 'tag' AS por_tag
SELECT
    sumIf(valor, hoy AND es_tx AND NOT fallo) AS recaudo_hoy,
    countIf(hoy AND es_tx AND NOT fallo) AS transacciones_hoy,
    round(100 * countIf(hoy AND es_tx AND NOT fallo AND por_tag) / greatest(countIf(hoy AND es_tx AND NOT fallo), 1), 1) AS tag_pct_hoy,
    sumIf(valor, hoy AND es_tx AND NOT fallo AND plaza = 'VEG') AS recaudo_veg_hoy,
    sumIf(valor, hoy AND es_tx AND NOT fallo AND plaza = 'SIS') AS recaudo_sis_hoy,
    sumIf(valor, hoy AND es_tx AND NOT fallo AND plaza = 'PBE') AS recaudo_pbe_hoy,
    sumIf(valor, ult_1h AND es_tx AND NOT fallo) AS recaudo_1h,
    countIf(ult_15m AND es_tx) AS transacciones_15m,
    countIf(ult_15m AND es_tx AND fallo) AS fallidas_15m,
    countIf(ult_15m AND es_tx AND SpanAttributes['peaje.tag_rechazado'] = 'true') AS tag_rechazados_15m,
    countIf(hoy AND es_tx AND SpanAttributes['peaje.contingencia'] = 'true') AS contingencia_hoy
FROM zabbix.otel_traces
WHERE Timestamp > now() - toIntervalHour(30)
  AND ResourceAttributes['service.namespace'] = '{$ARM.NS}'
  AND SpanKind = 'Server'
FORMAT JSONEachRow
"""

KPIS = [
    ("recaudo_hoy", "Recaudo hoy", "COP"), ("transacciones_hoy", "Transacciones hoy", "tx"), ("tag_pct_hoy", "Pagos con TAG hoy", "%"),
    ("recaudo_veg_hoy", "Recaudo hoy Peaje Vegachí", "COP"), ("recaudo_sis_hoy", "Recaudo hoy Peaje Santa Isabel", "COP"),
    ("recaudo_pbe_hoy", "Recaudo hoy Peaje Puerto Berrío", "COP"), ("recaudo_1h", "Recaudo en la última hora", "COP"),
    ("transacciones_15m", "Transacciones en 15 min", "tx"), ("fallidas_15m", "Transacciones fallidas en 15 min", "tx"),
    ("tag_rechazados_15m", "TAG rechazados en 15 min", "tx"), ("contingencia_hoy", "Transacciones sincronizadas desde contingencia hoy", "tx"),
]


def t_kpi():
    T = T_KPI
    items = [{"uuid": uuid(f"{T}:arm.kpi.get"), "name": "Recaudo: consulta de KPI a ClickHouse", "type": "HTTP_AGENT", "key": "arm.kpi.get",
              "delay": "30s", "history": "1h", "value_type": "TEXT", "timeout": "15s", "url": "{$CH.URL}", "posts": SQL_KPI,
              "headers": [{"name": "X-ClickHouse-User", "value": "{$CH.USER}"}, {"name": "X-ClickHouse-Key", "value": "{$CH.PASSWORD}"}],
              "request_method": "POST"}]
    for campo, nombre, units in KPIS:
        it = {"uuid": uuid(f"{T}:kpi:{campo}"), "name": f"Recaudo: {nombre}", "type": "DEPENDENT", "key": f"arm.kpi[{campo}]",
              "value_type": "FLOAT", "preprocessing": [{"type": "JSONPATH", "parameters": [f"$.{campo}"]}], "master_item": {"key": "arm.kpi.get"},
              "tags": tags(component="negocio")}
        if units:
            it["units"] = units
        items.append(it)
    return template(T, "KPI de negocio del recaudo (recaudo del día, por plaza, % TAG), calculados por Zabbix desde las trazas en ClickHouse.", items, macros=[
        ("{$ARM.NS}", "autopista", None), ("{$CH.PASSWORD}", "", None), ("{$CH.URL}", "http://clickhouse:8123/", None), ("{$CH.USER}", "zabbix", None)])


# ---------------------------------------------------------------- ITS
def t_its(tipo):
    T = T_ITS[tipo]
    ref = lambda k: f"/{T}/{k}"  # noqa: E731
    z = ZONA
    items = [
        trap(T, "its.en_linea", "ITS: en línea", "salud", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
            {"expr": f"nodata({ref('its.en_linea')},{{$ARM.ITS.NODATA}})=1", "nombre": "{HOST.NAME}: sin datos del equipo", "prioridad": "AVERAGE",
             "tags_": ttags(z, "sintoma", "its", "its_sin_datos", tipo)}]),
        trap(T, "its.latencia_ms", "ITS: latencia del enlace", "salud", units="ms"),
        trap(T, "its.temp_gabinete", "ITS: temperatura del gabinete", "salud", units="°C"),
    ]
    if tipo == "nodo":
        items += [
            trap(T, "its.enlace_troncal", "Nodo: enlace troncal de fibra", "red", "UNSIGNED", valuemap="Autopista sí/no", triggers=[
                {"expr": f"last({ref('its.enlace_troncal')})=0", "nombre": "{HOST.NAME}: enlace troncal de fibra caído", "prioridad": "HIGH",
                 "tags_": ttags(z, "causa", "red", "enlace_troncal", "fibra")}]),
            trap(T, "its.trafico_mbps", "Nodo: tráfico", "red", units="Mbps"),
        ]
    elif tipo == "dai":
        items += [
            trap(T, "its.detenidos", "Cámara DAI: vehículos detenidos en calzada", "deteccion", "UNSIGNED", triggers=[
                {"expr": f"last({ref('its.detenidos')})>0", "nombre": "{HOST.NAME}: vehículo detenido en calzada", "prioridad": "HIGH",
                 "tags_": ttags(z, "causa", "its", "vehiculo_detenido", "dai")}]),
            trap(T, "its.alertas_hoy", "Cámara DAI: alertas hoy", "deteccion", "UNSIGNED"),
            trap(T, "its.fps", "Cámara DAI: cuadros por segundo", "video", units="fps"),
        ]
    elif tipo == "radar":
        items += [trap(T, "its.vel_media", "Radar: velocidad media", "transito", units="km/h"),
                  trap(T, "its.vehiculos_h", "Radar: vehículos por hora", "transito", "UNSIGNED", units="veh/h")]
    elif tipo == "pmv":
        items += [trap(T, "its.mensaje", "PMV: mensaje publicado", "mensaje", "CHAR"),
                  trap(T, "its.brillo_pct", "PMV: brillo", "mensaje", units="%")]
    elif tipo == "meteo":
        items += [
            trap(T, "its.precipitacion", "Meteo: precipitación", "clima", units="mm/h", triggers=[
                {"expr": f"last({ref('its.precipitacion')})>{{$ARM.PRECIP.MAX}}", "nombre": "{HOST.NAME}: precipitación intensa ({ITEM.LASTVALUE})", "prioridad": "AVERAGE",
                 "tags_": ttags(z, "causa", "its", "lluvia_intensa", "meteo")}]),
            trap(T, "its.visibilidad", "Meteo: visibilidad", "clima", units="m", triggers=[
                {"expr": f"last({ref('its.visibilidad')})<{{$ARM.VISIBILIDAD.MIN}}", "nombre": "{HOST.NAME}: visibilidad reducida ({ITEM.LASTVALUE})", "prioridad": "AVERAGE",
                 "tags_": ttags(z, "sintoma", "its", "visibilidad_baja", "meteo")}]),
            trap(T, "its.temperatura", "Meteo: temperatura", "clima", units="°C"),
            trap(T, "its.humedad", "Meteo: humedad relativa", "clima", units="%"),
        ]
    elif tipo == "galibo":
        items += [
            trap(T, "its.altura_m", "Gálibo: altura del último vehículo", "galibo", units="m", triggers=[
                {"expr": f"last({ref('its.altura_m')})>{{$ARM.GALIBO.MAX}}", "nombre": "{HOST.NAME}: vehículo sobredimensionado ({ITEM.LASTVALUE})", "prioridad": "HIGH",
                 "tags_": ttags(z, "causa", "its", "sobredimensionado", "galibo"), "manual_close": True}]),
            trap(T, "its.detecciones_hoy", "Gálibo: detecciones hoy", "galibo", "UNSIGNED"),
        ]
    macros = [("{$ARM.ZONA}", "sin_zona", "UF del equipo (tag zona para el CEP). Se define en cada host."),
              ("{$ARM.ITS.NODATA}", "90s", "Tiempo sin datos antes de considerar el equipo sin comunicación.")]
    if tipo == "meteo":
        macros += [("{$ARM.PRECIP.MAX}", "20", "Precipitación intensa (mm/h)."), ("{$ARM.VISIBILIDAD.MIN}", "300", "Visibilidad mínima (m).")]
    if tipo == "galibo":
        macros += [("{$ARM.GALIBO.MAX}", "4.5", "Altura máxima permitida antes del puente (m).")]
    return template(T, f"Equipo ITS del corredor ({tipo}), datos por trapper del simulador.", items, macros=macros,
                    valuemaps=[vmap(T, "Autopista sí/no", [(0, "No"), (1, "Sí")])])


# ---------------------------------------------------------------- hosts
def host(tecnico, visible, templates_, grupo, macros=(), extra_tags=None):
    h = {"host": tecnico, "name": visible, "templates": [{"name": t} for t in templates_], "groups": [{"name": grupo}],
         "tags": tags(demo="autopista", **(extra_tags or {}))}
    if macros:
        h["macros"] = [dict(m) for m in macros]
    return h


def hosts():
    lista = [
        host(H_DISCOVERY, H_DISCOVERY, ["APM applications discovery by ClickHouse HTTP v3"], G_APM, macros=[
            {"macro": "{$APM.NAMESPACE.MATCHES}", "value": "^autopista$"}, {"macro": "{$CH.PASSWORD}", "type": "SECRET_TEXT"},
            {"macro": "{$CH.URL}", "value": "http://clickhouse:8123/"}, {"macro": "{$CH.USER}", "value": "zabbix"}]),
        host(H_CORREDOR, H_CORREDOR, [T_CORREDOR], G_CORREDOR),
        host(H_PLATAFORMA, H_PLATAFORMA, [T_PLATAFORMA], G_RECAUDO),
        host(H_RECAUDO, H_RECAUDO, [T_APM, T_KPI], G_RECAUDO),
    ]
    for pid, (tec, vis) in PEAJES.items():
        p = next(x for x in C["plazas"] if x["id"] == pid)
        lista.append(host(tec, vis, [T_PEAJE], G_PEAJES, macros=[{"macro": ZONA, "value": p["uf"]}], extra_tags={"plaza": pid}))
    for d in C["its"]:
        lista.append(host(f"Autopista - ITS {d['id']}", f"Autopista - {d['nombre']}", [T_ITS[d["tipo"]]], G_ITS,
                          macros=[{"macro": ZONA, "value": uf_de(d["s"])}], extra_tags={"equipo": d["tipo"]}))
    grupos = [G_APM, G_CORREDOR, G_ITS, G_PEAJES, G_RECAUDO]
    return {"zabbix_export": {"version": "8.0", "host_groups": [{"uuid": uuid(f"g:{g}"), "name": g} for g in grupos],
                              "hosts": sorted(lista, key=lambda h: h["host"])}}


# ---------------------------------------------------------------- dashboards
OSCURO, BLANCO = "263238", "FFFFFF"
VERDE, AMARILLO, NARANJA, ROJO, AZUL, CIAN, VIOLETA, GRIS = "0CA30C", "FAB219", "EB6834", "D03B3B", "2A78D6", "1BAF7A", "8E5BD8", "97AAB3"


def F(tipo, nombre, valor):
    return {"type": tipo, "name": nombre, "value": valor}


def I(nombre, valor):
    return F("INTEGER", nombre, str(valor))


def S(nombre, valor):
    return F("STRING", nombre, str(valor))


def W(tipo, nombre, x, y, w, h, campos, ocultar=False):
    wd = {"type": tipo, "name": nombre}
    if x:
        wd["x"] = str(x)
    if y:
        wd["y"] = str(y)
    wd["width"], wd["height"] = str(w), str(h)
    if ocultar:
        wd["hide_header"] = "YES"
    wd["fields"] = campos
    return wd


def umbrales(lista, prefijo="thresholds"):
    out = []
    for i, (valor, color) in enumerate(lista):
        out += [S(f"{prefijo}.{i}.color", color), S(f"{prefijo}.{i}.threshold", valor)]
    return out


def tile(nombre, host_, key, x, y, w=12, h=3, dec=0, th=None, fondo=OSCURO):
    return W("item", nombre, x, y, w, h, [
        S("bg_color", fondo), I("decimal_places", dec), I("decimal_size", 20), S("description", nombre), I("desc_bold", 1),
        S("desc_color", BLANCO), I("desc_h_pos", 1), I("desc_size", 13), I("desc_v_pos", 0),
        F("ITEM", "itemid.0", {"host": host_, "key": key}), I("show.0", 1), I("show.1", 2), I("show.2", 5),
        S("sparkline.color", BLANCO), I("sparkline.fill", 2), S("sparkline.time_period.from", "now-30m"), S("sparkline.time_period.to", "now"),
        I("sparkline.width", 2), *umbrales(th or [("0", fondo)]), S("units_color", BLANCO), I("units_size", 14), I("value_bold", 1),
        S("value_color", BLANCO), I("value_h_pos", 1), I("value_size", 30), I("value_v_pos", 1)], ocultar=True)


def grafico(nombre, x, y, w, h, series, hosts_problemas=None, desde="now-1h"):
    campos = []
    for i, (host_, item, color) in enumerate(series):
        campos += [S(f"ds.{i}.color", color), I(f"ds.{i}.fill", 1), S(f"ds.{i}.hosts.0", host_), S(f"ds.{i}.items.0", item),
                   I(f"ds.{i}.pointsize", 3), I(f"ds.{i}.transparency", 5), I(f"ds.{i}.type", 0), I(f"ds.{i}.width", 2)]
    campos += [S("lefty_min", "0"), I("legend", 1), I("legend_columns", 3), I("legend_lines", 2)]
    if hosts_problemas:
        campos += [S("problemhosts.0", hosts_problemas), I("show_problems", 1)]
    campos += [S("time_period.from", desde), S("time_period.to", "now")]
    return W("svggraph", nombre, x, y, w, h, campos)


def problemas(nombre, x, y, w, h, filtros, lineas=12, prioridad="zona,rol,problema"):
    campos = [I("evaltype", 0), I("highlight_row", 1)]
    campos += [I(f"severities.{i}", s) for i, s in enumerate([2, 3, 4, 5])]
    campos += [I("show", 3), I("show_lines", lineas), I("show_tags", 3), I("show_timeline", 1), I("sort_triggers", 4)]
    for i, (tag, op, valor) in enumerate(filtros):
        campos += [I(f"tags.{i}.operator", op), S(f"tags.{i}.tag", tag), S(f"tags.{i}.value", valor)]
    campos += [S("tag_priority", prioridad), I("tag_name_format", 0)]
    return W("problems", nombre, x, y, w, h, campos)


def por_severidad(nombre, x, y, w, h, grupos):
    campos = [F("GROUP", f"groupids.{i}", {"name": g}) for i, g in enumerate(grupos)]
    campos += [I("layout", 1)] + [I(f"severities.{i}", s) for i, s in enumerate([2, 3, 4, 5])] + [I("show_type", 1)]
    return W("problemsbysv", nombre, x, y, w, h, campos)


def panal(nombre, x, y, w, h, grupo, items, th):
    campos = [S("bg_color", OSCURO), F("GROUP", "groupids.0", {"name": grupo})]
    campos += [S(f"items.{i}", it) for i, it in enumerate(items)]
    campos += [S("primary_label", "{HOST.NAME}"), I("primary_label_bold", 1), S("primary_label_color", BLANCO), I("primary_label_size_type", 0),
               I("primary_label_type", 0), I("secondary_label_bold", 1), S("secondary_label_color", BLANCO), I("secondary_label_decimal_places", 0),
               I("secondary_label_size_type", 0), I("secondary_label_type", 1), I("show.0", 1), I("show.1", 2), *umbrales(th)]
    return W("honeycomb", nombre, x, y, w, h, campos)


def torta(nombre, x, y, w, h, series):
    campos = [I("decimal_places", 0), I("draw_type", 1)]
    for i, (etiqueta, host_, item, color) in enumerate(series):
        campos += [I(f"ds.{i}.aggregate_function", 7), S(f"ds.{i}.color", color), I(f"ds.{i}.dataset_aggregation", 0), I(f"ds.{i}.dataset_type", 1),
                   S(f"ds.{i}.data_set_label", etiqueta), S(f"ds.{i}.hosts.0", host_), S(f"ds.{i}.items.0", item)]
    campos += [I("legend", 1), I("legend_columns", 1), I("legend_lines", 3), I("space", 2), S("time_period.from", "now-5m"), S("time_period.to", "now"),
               I("total_show", 1), S("units", "COP"), I("units_show", 1), I("value_size_type", 0), I("width", 40)]
    return W("piechart", nombre, x, y, w, h, campos)


def medidor(nombre, host_, key, x, y, w, h, minimo, maximo, th, dec=0):
    return W("gauge", nombre, x, y, w, h, [
        I("angle", 180), I("decimal_places", dec), S("description", nombre), I("desc_bold", 1), I("desc_size", 12),
        F("ITEM", "itemid.0", {"host": host_, "key": key}), S("max", maximo), S("min", minimo),
        I("show.0", 1), I("show.1", 2), I("show.2", 3), I("show.3", 4), I("show.4", 5), *umbrales(th),
        I("th_arc_size", 8), I("th_show_arc", 1), I("th_show_labels", 0), I("units_size", 14), I("value_arc_size", 20), I("value_bold", 1), I("value_size", 22)],
        ocultar=True)


def dashboards():
    R, CO, PL = H_RECAUDO, H_CORREDOR, H_PLATAFORMA
    veg, sis, pbe = PEAJES["VEG"][0], PEAJES["SIS"][0], PEAJES["PBE"][0]
    pag_corredor = {"name": "Corredor y tránsito", "widgets": [
        tile("Vehículos en el corredor", CO, "arm.vehiculos", 0, 0),
        tile("Flujo de ingreso (veh/h)", CO, "arm.flujo_h", 12, 0),
        tile("Velocidad media", CO, "arm.velocidad_media", 24, 0, dec=1, th=[("0", ROJO), ("35", AMARILLO), ("50", OSCURO)]),
        tile("Cola máxima en la vía", CO, "arm.cola_max_km", 36, 0, dec=2, th=[("0", OSCURO), ("0.4", NARANJA), ("1", ROJO)]),
        tile("Recaudo hoy (desde trazas)", R, "arm.kpi[recaudo_hoy]", 48, 0),
        tile("Transacciones hoy", R, "arm.kpi[transacciones_hoy]", 60, 0),
        grafico("Velocidad media por tramo · hacia Pto. Berrío", 0, 3, 36, 6, [(CO, "Tramo UF-*hacia Pto. Berrío: velocidad media", AZUL)], CO),
        grafico("Velocidad media por tramo · hacia Remedios", 36, 3, 36, 6, [(CO, "Tramo UF-*hacia Remedios: velocidad media", CIAN)], CO),
        problemas("Problemas del corredor", 0, 9, 48, 6, [("demo", 1, "autopista")]),
        por_severidad("Por severidad", 48, 9, 24, 6, [G_CORREDOR, G_PEAJES, G_ITS, G_RECAUDO]),
        grafico("Colas en la vía (km)", 0, 15, 36, 5, [(CO, "Tramo UF-*: cola", NARANJA)], CO),
        panal("Equipos ITS en línea", 36, 15, 36, 5, G_ITS, ["ITS: en línea"], [("0", ROJO), ("1", VERDE)]),
    ]}
    pag_peajes = {"name": "Peajes", "widgets": [
        tile("Vegachí: carriles abiertos", veg, "arm.peaje.carriles_abiertos", 0, 0, th=[("0", ROJO), ("6", OSCURO)]),
        tile("Santa Isabel: carriles abiertos", sis, "arm.peaje.carriles_abiertos", 12, 0, th=[("0", ROJO), ("6", OSCURO)]),
        tile("Pto. Berrío: carriles abiertos", pbe, "arm.peaje.carriles_abiertos", 24, 0, th=[("0", ROJO), ("6", OSCURO)]),
        tile("Pagos con TAG hoy (%)", R, "arm.kpi[tag_pct_hoy]", 36, 0, dec=1),
        tile("TAG rechazados en 15 min", R, "arm.kpi[tag_rechazados_15m]", 48, 0, th=[("0", OSCURO), ("5", NARANJA)]),
        tile("Pendientes de conciliar", PL, "arm.conciliacion.pendientes", 60, 0, th=[("0", OSCURO), ("50", AMARILLO)]),
        grafico("Cola máxima por plaza (vehículos)", 0, 3, 36, 6, [(veg, "Peaje: cola máxima en carril", AZUL), (sis, "Peaje: cola máxima en carril", CIAN),
                                                                  (pbe, "Peaje: cola máxima en carril", VIOLETA)]),
        grafico("Transacciones por hora por plaza", 36, 3, 36, 6, [(veg, "Peaje: transacciones por hora", AZUL), (sis, "Peaje: transacciones por hora", CIAN),
                                                                    (pbe, "Peaje: transacciones por hora", VIOLETA)]),
        medidor("UPS Peaje Vegachí", veg, "arm.peaje.ups_bateria", 0, 9, 12, 5, "0", "100", [("0", ROJO), ("30", AMARILLO), ("60", VERDE)]),
        medidor("Latencia de autorización Vegachí (ms)", veg, "arm.peaje.latencia_ms", 12, 9, 12, 5, "0", "5000", [("0", VERDE), ("800", AMARILLO), ("2000", ROJO)]),
        torta("Recaudo de hoy por plaza", 24, 9, 22, 5, [("Vegachí", R, "Recaudo: Recaudo hoy Peaje Vegachí", AZUL), ("Santa Isabel", R, "Recaudo: Recaudo hoy Peaje Santa Isabel", CIAN),
                                                       ("Puerto Berrío", R, "Recaudo: Recaudo hoy Peaje Puerto Berrío", VIOLETA)]),
        problemas("Problemas en peajes", 46, 9, 26, 5, [("demo", 1, "autopista"), ("nivel", 1, "ot")], lineas=8),
        grafico("Colas por carril · Peaje Puerto Berrío", 0, 14, 36, 5, [(pbe, "Carril *: cola", NARANJA)]),
        grafico("TAG rechazados por plaza (%)", 36, 14, 36, 5, [(veg, "Peaje: TAG rechazados", AZUL), (sis, "Peaje: TAG rechazados", CIAN), (pbe, "Peaje: TAG rechazados", VIOLETA)]),
    ]}
    pag_apm = {"name": "Recaudo y APM", "widgets": [
        tile("Gateway p95 (s)", R, "arm.apm.gateway.p95", 0, 0, dec=2, th=[("0", OSCURO), ("1", AMARILLO), ("2", ROJO)]),
        tile("Gateway errores (%)", R, "arm.apm.gateway.error_pct", 12, 0, dec=1, th=[("0", OSCURO), ("5", ROJO)]),
        tile("Registro p95 (s)", R, "arm.apm.transacciones.p95", 24, 0, dec=2, th=[("0", OSCURO), ("1", ROJO)]),
        tile("Validación TAG errores (%)", R, "arm.apm.validacion.error_pct", 36, 0, dec=1, th=[("0", OSCURO), ("20", ROJO)]),
        tile("Recaudo última hora", R, "arm.kpi[recaudo_1h]", 48, 0),
        tile("Transacciones fallidas 15 min", R, "arm.kpi[fallidas_15m]", 60, 0, th=[("0", OSCURO), ("1", NARANJA), ("10", ROJO)]),
        grafico("Latencia p95 por servicio (trazas)", 0, 3, 36, 6, [(R, "APM *: p95", AZUL)], R),
        grafico("Tasa de errores por servicio (trazas)", 36, 3, 36, 6, [(R, "APM *: tasa de errores", ROJO)], R),
        grafico("Solicitudes por minuto", 0, 9, 36, 5, [(R, "APM *: solicitudes por minuto", CIAN)]),
        grafico("Plataforma: BD, heap e interoperabilidad", 36, 9, 36, 5, [(PL, "BD recaudo: sesiones bloqueadas", ROJO), (PL, "Gateway de recaudo: memoria heap", VIOLETA),
                                                                             (PL, "BD recaudo: uso del pool de conexiones", NARANJA)], PL),
        problemas("Problemas de la plataforma de recaudo", 0, 14, 72, 5, [("demo", 1, "autopista"), ("recaudo", 1, "si")], lineas=8, prioridad="zona,nivel,problema,causa_raiz"),
    ]}
    pag_cep = {"name": "CEP: causa raíz", "widgets": [
        problemas("Incidentes detectados por patrón (CEP)", 0, 0, 72, 5, [("demo", 1, "autopista"), ("incidente", 4, "")], lineas=6, prioridad="incidente,zona,problema"),
        problemas("Causas y síntomas por zona (ventana CEP)", 0, 5, 48, 8, [("demo", 1, "autopista")], lineas=16, prioridad="zona,rol,problema,responsable"),
        por_severidad("Problemas por severidad", 48, 5, 24, 8, [G_CORREDOR, G_PEAJES, G_ITS, G_RECAUDO]),
        problemas("Síntomas en las plazas con causa raíz en la plataforma central", 0, 13, 72, 5, [("demo", 1, "autopista"), ("causa_raiz", 4, "")], lineas=8,
                  prioridad="causa_raiz,zona,problema"),
    ]}
    return {"zabbix_export": {"version": "8.0", "dashboards": [
        {"name": "Autopista · Operación del corredor", "pages": [pag_corredor, pag_peajes, pag_apm, pag_cep]},
    ]}}


# ---------------------------------------------------------------- YAML
CLAVES_CITAR = {"y", "n", "yes", "no", "on", "off", "true", "false"}


def escalar(v, sangria):
    s = str(v)
    if "\n" in s:
        pad = " " * (sangria + 2)
        return "|\n" + "\n".join((pad + linea) if linea else "" for linea in s.split("\n"))
    return "'" + s.replace("'", "''") + "'"


def yaml(v, sangria=0):
    pad = " " * sangria
    lineas = []
    if isinstance(v, list):
        for x in v:
            if isinstance(x, (dict, list)):
                cuerpo = yaml(x, sangria + 2)
                lineas.append(f"{pad}- " + cuerpo.lstrip(" "))
            else:
                lineas.append(f"{pad}- {escalar(x, sangria)}")
        return "\n".join(lineas)
    for k, x in v.items():
        if x is None:
            continue
        clave = f"'{k}'" if k in CLAVES_CITAR else k
        if isinstance(x, (dict, list)):
            if not x:
                lineas.append(f"{pad}{clave}: []" if isinstance(x, list) else f"{pad}{clave}: {{}}")
            else:
                lineas.append(f"{pad}{clave}:\n{yaml(x, sangria + 2)}")
        else:
            lineas.append(f"{pad}{clave}: {escalar(x, sangria)}")
    return "\n".join(lineas)


def main():
    plantillas = [t_corredor(), t_peaje(), t_plataforma(), t_apm(), t_kpi()] + [t_its(t) for t in T_ITS]
    tpl = {"zabbix_export": {"version": "8.0", "template_groups": [{"uuid": uuid(f"tg:{GRUPO_T}"), "name": GRUPO_T}],
                             "templates": sorted(plantillas, key=lambda t: t["template"])}}
    SALIDA.mkdir(parents=True, exist_ok=True)
    for nombre, doc in (("templates_autopista.yaml", tpl), ("hosts_autopista.yaml", hosts()), ("dashboards_autopista.yaml", dashboards())):
        (SALIDA / nombre).write_text(yaml(doc) + "\n", encoding="utf-8")
        print(f"OK provision/export/{nombre}")
    n_items = sum(len(t["items"]) for t in plantillas)
    n_trig = sum(1 for t in plantillas for i in t["items"] for _ in i.get("triggers", []))
    print(f"   {len(plantillas)} templates, {n_items} ítems, {n_trig} triggers, {len(hosts()['zabbix_export']['hosts'])} hosts")


if __name__ == "__main__":
    main()
