#!/usr/bin/env python3
"""Pasos propios de la demo autopista, después de importar los YAML: macros de entorno y reglas CEP. Idempotente.

Reglas CEP (no entran por import, se crean o actualizan por nombre):
  1. Responsable por nivel: sin ventana, agrega el tag "responsable" (CCO, mantenimiento ITS, telecomunicaciones, TI).
  2. Causa y síntomas por zona: ventana agrupada por el tag zona (UF1..UF4, central). El primer evento de la zona es la
     causa y los siguientes, sus síntomas. Si la ventana la abre un síntoma se cierra (espera una causa real), y el
     evento de control recurso=reinicio la cierra para que una falla nueva no quede como síntoma de la anterior.
  3. a 6. Incidentes por patrón: cuando la causa y sus síntomas están abiertos a la vez, la causa pasa a "INCIDENTE" con
     más severidad. La de recaudo cruza zonas: marca con causa_raiz los síntomas que aparecen en las plazas (TAG
     rechazados, colas) cuando la causa está en la plataforma central.
Solo usa tags propios (demo, zona, rol, nivel, problema, recaudo, recurso): dominio y capa son de otras reglas del lab.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # zabbix_api.py está en /srv
from zabbix_api import crear_api  # noqa: E402

# Constantes de CCepRuleHelper / defines.inc.php (Zabbix 8.0)
WINDOW_NONE, WINDOW_CAUSE_SYMPTOM, WINDOW_PATTERN = 0, 2, 4
WHEN_OCCURRED, WHEN_ADDED, WHEN_PATTERN = 0, 1, 4
OP_SET_NAME, OP_SET_SEVERITY, OP_ADD_TAG, OP_SET_TAG, OP_CLOSE_WINDOW = 1, 4, 11, 12, 18
SCOPE_CURRENT, SCOPE_ALL_EVENTS = 0, 2
COND_TAG, COND_TAG_VALUE, COND_EVENT_OPEN, COND_FIRST, COND_COPIED = 25, 26, 30, 31, 34
EQUAL, YES, NO = 0, 10, 11
HIGH, DISASTER = 4, 5
SECRETA = 1

TEMPLATE_KPI = "Autopista KPIs by ClickHouse"
TEMPLATE_APM = "Autopista APM by Telemetry query"
HOST_DISCOVERY = "Autopista - APM discovery"
PREFIJO = "Autopista: "


def cond(tipo, operador, **kw):
    return {"type": tipo, "operator": operador, **kw}


def tag(nombre, valor):
    return cond(COND_TAG_VALUE, EQUAL, tag=nombre, tag_value=valor)


def existe(nombre):
    return cond(COND_TAG, EQUAL, tag=nombre)


def filtro(*condiciones):
    return {"evaltype": 0 if not condiciones else 1, "conditions": list(condiciones)}


DE_LA_DEMO = tag("demo", "autopista")
ORIGINAL_ABIERTO = [cond(COND_COPIED, NO), cond(COND_EVENT_OPEN, YES)]


def ventana(**kw):
    return {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 0, "tags": [],
            "event_count_tag": "", "script": "", **kw}


def op(orden, cuando, tipo, condiciones=(), scope=SCOPE_ALL_EVENTS, **kw):
    # scope_filter elige sobre qué eventos actúa la operación; filter miraría solo el evento que la disparó
    return {"sortorder": orden, "execute_when": cuando, "type": tipo, "scope": scope,
            "scope_filter": filtro(*condiciones), **kw}


def script(causas, minimo, sintomas=None):
    """Patrón: una causa abierta (problema en `causas`) y al menos `minimo` síntomas abiertos (rol=sintoma)."""
    lista = "[" + ", ".join(f"'{c}'" for c in causas) + "]"
    filtro_s = "" if not sintomas else " && [" + ", ".join(f"'{s}'" for s in sintomas) + "].indexOf(valor(ev[i], 'problema')) !== -1"
    return f"""
var ev = cep_get_events(), causa = false, sintomas = 0;
function valor(e, nombre) {{
    for (var i = 0; i < e.tags.length; i++) {{ if (e.tags[i].tag === nombre) {{ return e.tags[i].value; }} }}
    return '';
}}
for (var i = 0; i < ev.length; i++) {{
    if (ev[i].is_copied || !ev[i].is_open) {{ continue; }}
    if ({lista}.indexOf(valor(ev[i], 'problema')) !== -1) {{ causa = true; }}
    else if (valor(ev[i], 'rol') === 'sintoma'{filtro_s}) {{ sintomas++; }}
}}
return causa && sintomas >= {minimo};
"""


def incidente(nombre, orden, descripcion, filtro_regla, causas, minimo, titulo, severidad, etiqueta, sintomas=None, causa_raiz=None):
    ancla = [*ORIGINAL_ABIERTO, existe("rol"), tag("rol", "causa")]
    ops = []
    n = 1
    if titulo:
        ops.append(op(n, WHEN_PATTERN, OP_SET_NAME, ancla + [tag("problema", causas[0])], event_name=titulo))
        n += 1
    for c in causas:
        ops.append(op(n, WHEN_PATTERN, OP_SET_SEVERITY, ancla + [tag("problema", c)], severity=severidad))
        ops.append(op(n + 1, WHEN_PATTERN, OP_ADD_TAG, ancla + [tag("problema", c)], tag="incidente", tag_value=etiqueta))
        n += 2
    if causa_raiz:
        ops.append(op(n, WHEN_PATTERN, OP_ADD_TAG, [*ORIGINAL_ABIERTO, tag("rol", "sintoma")], tag="causa_raiz", tag_value=causa_raiz))
        n += 1
    # el patrón se evalúa cada segundo: cerrar la ventana evita que las operaciones se repitan en el historial
    ops.append(op(n, WHEN_PATTERN, OP_CLOSE_WINDOW))
    return {
        "name": f"{PREFIJO}{nombre}", "sortorder": orden, "status": 0, "stop": 0, "window_type": WINDOW_PATTERN,
        "description": descripcion, "filter": filtro(DE_LA_DEMO, *filtro_regla),
        "window": ventana(duration="30m", script=script(causas, minimo, sintomas)),
        "operations": ops,
    }


RESPONSABLES = [("ot", "CCO · Jefe de operación vial"), ("its", "Mantenimiento ITS"), ("red", "Telecomunicaciones"),
                ("infra", "TI · Plataforma de recaudo"), ("apm", "TI · Plataforma de recaudo")]

REGLAS = [
    {
        "name": f"{PREFIJO}responsable por nivel", "sortorder": 40, "status": 0, "stop": 0, "window_type": WINDOW_NONE,
        "description": "Agrega el tag responsable según el nivel del evento (OT, ITS, red, infraestructura o APM).",
        "filter": filtro(DE_LA_DEMO, existe("nivel")), "window": ventana(duration="10m"),
        "operations": [op(i + 1, WHEN_OCCURRED, OP_SET_TAG, scope=SCOPE_CURRENT, tag="responsable", tag_value=quien,
                          **{"filter": filtro(tag("nivel", nivel))}) for i, (nivel, quien) in enumerate(RESPONSABLES)],
    },
    {
        "name": f"{PREFIJO}causa y síntomas por zona", "sortorder": 41, "status": 0, "stop": 0, "window_type": WINDOW_CAUSE_SYMPTOM,
        "description": "El primer evento de cada zona (UF-1 a UF-4 o la plataforma central) es la causa; los siguientes de la misma zona, sus síntomas.",
        "filter": filtro(DE_LA_DEMO, existe("zona")),
        "window": ventana(group_by_tags=1, tags=["zona"], event_count_tag="eventos_correlacionados"),
        "operations": [
            {"sortorder": 1, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW, "filter": filtro(tag("recurso", "reinicio"))},
            {"sortorder": 2, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW, "filter": filtro(cond(COND_FIRST, YES), tag("rol", "sintoma"))},
        ],
    },
    incidente("incidente corte de fibra UF-2", 42,
              "Enlace troncal caído con equipos ITS sin datos y el peaje Vegachí en contingencia: un solo incidente.",
              [tag("zona", "UF2")], ["enlace_troncal"], 2,
              "INCIDENTE: corte de fibra en la UF-2 · ITS sin datos y Peaje Vegachí en contingencia", HIGH, "fibra_uf2"),
    incidente("incidente accidente con cola", 43,
              "Vehículo detenido detectado por la cámara DAI y cola o velocidad baja en la UF-3.",
              [tag("zona", "UF3")], ["vehiculo_detenido"], 1,
              "INCIDENTE: accidente en el km 100 con cola en la UF-3", DISASTER, "accidente_uf3", sintomas=["cola_vial", "velocidad_baja"]),
    incidente("incidente peaje sin energía", 44,
              "Peaje sin red eléctrica con la planta o la UPS fallando y carriles cerrados.",
              [tag("zona", "UF2")], ["sin_energia"], 2,
              "INCIDENTE: Peaje Vegachí sin energía · carriles cerrados", HIGH, "energia_vegachi"),
    incidente("incidente recaudo degradado", 45,
              "Falla en la plataforma central de recaudo con síntomas de APM y en las plazas: marca la causa raíz en los síntomas de todas las zonas.",
              [existe("recaudo")], ["bd_bloqueos", "operador_tag", "heap_gateway"], 2,
              None, HIGH, "recaudo_degradado", causa_raiz="plataforma_recaudo"),
]


def fijar_macro(api, hostid, macro, valor, secreta=False):
    existentes = {m["macro"]: m for m in api("usermacro.get", {"hostids": [hostid], "output": ["hostmacroid", "macro", "value"]})}
    actual = existentes.get(macro)
    if actual is None:
        parametros = {"hostid": hostid, "macro": macro, "value": valor}
        if secreta:
            parametros["type"] = SECRETA
        api("usermacro.create", parametros)
    elif secreta or actual.get("value") != valor:
        api("usermacro.update", {"hostmacroid": actual["hostmacroid"], "value": valor})


def main():
    api = crear_api(os.environ["ZABBIX_URL"], os.environ["ZABBIX_API_TOKEN"])
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "autopista")
    ch = (os.environ.get("CH_URL", "http://clickhouse:8123/"), os.environ.get("CH_USER", "zabbix"), os.environ.get("CH_PASSWORD", ""))

    t = {x["host"]: x["templateid"] for x in api("template.get", {"output": ["host"], "filter": {"host": [TEMPLATE_KPI, TEMPLATE_APM]}})}
    h = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST_DISCOVERY]}})
    if len(t) != 2 or not h:
        raise SystemExit("!! Faltan templates o el host de discovery: revisar la importación")
    hid = h[0]["hostid"]
    for objetivo in (t[TEMPLATE_KPI], hid):
        fijar_macro(api, objetivo, "{$CH.URL}", ch[0])
        fijar_macro(api, objetivo, "{$CH.USER}", ch[1])
        fijar_macro(api, objetivo, "{$CH.PASSWORD}", ch[2], secreta=True)
    fijar_macro(api, t[TEMPLATE_KPI], "{$ARM.NS}", ns)
    fijar_macro(api, t[TEMPLATE_APM], "{$ARM.NS}", ns)
    fijar_macro(api, hid, "{$APM.NAMESPACE.MATCHES}", f"^{ns}$")
    print(f"OK macros de ClickHouse y namespace {ns}")

    errores = 0
    for regla in REGLAS:
        try:
            r = api("ceprule.get", {"output": ["cep_ruleid"], "filter": {"name": [regla["name"]]}})
            if r:
                api("ceprule.update", [{"cep_ruleid": r[0]["cep_ruleid"], **regla}])
                print(f"OK regla '{regla['name']}' actualizada")
            else:
                api("ceprule.create", [regla])
                print(f"OK regla '{regla['name']}' creada")
        except RuntimeError as e:
            errores += 1
            print(f"!! regla '{regla['name']}': {e}")
    for r in api("ceprule.get", {"output": ["name", "error"], "search": {"name": PREFIJO}, "startSearch": True}):
        if r.get("error"):
            print(f"!! regla '{r['name']}' con error en Zabbix: {r['error']}")
    if errores:
        raise SystemExit(f"!! {errores} regla(s) CEP no se pudieron crear")


if __name__ == "__main__":
    main()
