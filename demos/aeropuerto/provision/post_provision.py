#!/usr/bin/env python3
"""Pasos propios de la demo aeropuerto, después de importar los YAML: macros de entorno y reglas CEP. Idempotente.

Reglas CEP (no entran por import, se crean o actualizan por nombre):
  1. Causa y síntomas por tag terminal: el primer evento de la ventana es la causa. El evento de control recurso=reinicio
     la cierra, para que una falla nueva no quede como síntoma de la anterior.
  2. Frecuencia: tres vuelos demorados en la ventana son un solo problema operativo.
  3. Evento esperado ausente: un trigger detecta el embarque sin salida dentro del plazo y la regla consolida ese problema
     con el embarque abierto. La operación "window closed" no actuó sobre eventos abiertos en Zabbix 8.0.0, por eso no se usa.
Solo usa tags propios (demo, terminal, nivel, tipo, flujo, vuelo, ancla): dominio y capa son de las reglas de la planta.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # zabbix_api.py está en /srv
from zabbix_api import crear_api  # noqa: E402

# Constantes de CCepRuleHelper / defines.inc.php (Zabbix 8.0)
WINDOW_CAUSE_SYMPTOM, WINDOW_PATTERN = 2, 4
WHEN_ADDED, WHEN_PATTERN = 1, 4
OP_SET_NAME, OP_SET_SEVERITY, OP_SUPPRESS, OP_ADD_TAG, OP_CLOSE_WINDOW = 1, 4, 7, 11, 18
SCOPE_ALL_EVENTS = 2
COND_TAG, COND_TAG_VALUE, COND_EVENT_OPEN, COND_COPIED, COND_SUPPRESSED = 25, 26, 30, 34, 35
EQUAL, YES, NO = 0, 10, 11
HIGH = 4
SECRETA = 1

TEMPLATE_KPI = "Aeropuerto KPIs by ClickHouse"
TEMPLATE_APM = "Aeropuerto APM by Telemetry query"
HOST_DISCOVERY = "Aeropuerto - APM discovery"


def cond(tipo, operador, **kw):
    return {"type": tipo, "operator": operador, **kw}


def tag(nombre, valor):
    return cond(COND_TAG_VALUE, EQUAL, tag=nombre, tag_value=valor)


DE_LA_DEMO = tag("demo", "aeropuerto")
ORIGINAL_ABIERTO = [cond(COND_COPIED, NO), cond(COND_EVENT_OPEN, YES)]

SCRIPT_AUSENTE = r"""
var ev = cep_get_events(), ausente = false, embarque = false;
function tipo(e, valor) {
    for (var i = 0; i < e.tags.length; i++) { if (e.tags[i].tag === 'tipo' && e.tags[i].value === valor) { return true; } }
    return false;
}
for (var i = 0; i < ev.length; i++) {
    if (ev[i].is_copied || !ev[i].is_open) { continue; }
    if (tipo(ev[i], 'ausente')) { ausente = true; }
    if (tipo(ev[i], 'embarque')) { embarque = true; }
}
return ausente && embarque;
"""

SCRIPT_DEMORAS = r"""
var ev = cep_get_events(), n = 0;
for (var i = 0; i < ev.length; i++) {
    if (!ev[i].is_copied && ev[i].is_open) { n++; }
}
return n >= 3;
"""


def op(orden, cuando, tipo, condiciones, **kw):
    # scope_filter elige sobre qué eventos actúa la operación; filter miraría solo el evento que la disparó
    return {"sortorder": orden, "execute_when": cuando, "type": tipo, "scope": SCOPE_ALL_EVENTS,
            "scope_filter": {"evaltype": 0, "conditions": condiciones}, **kw}


ANCLA = [*ORIGINAL_ABIERTO, tag("ancla", "si")]
AUSENTE = [*ORIGINAL_ABIERTO, tag("tipo", "ausente")]
EMBARQUE_ABIERTO = [*ORIGINAL_ABIERTO, cond(COND_SUPPRESSED, NO), tag("tipo", "embarque")]

REGLAS = [
    {
        "name": "Aeropuerto: causa y síntomas por terminal", "sortorder": 20, "status": 0, "stop": 0,
        "window_type": WINDOW_CAUSE_SYMPTOM,
        "description": "El primer evento de la terminal es la causa; los siguientes, sus síntomas, hasta el evento de control.",
        "filter": {"evaltype": 0, "conditions": [DE_LA_DEMO, cond(COND_TAG, EQUAL, tag="terminal")]},
        "window": {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 1,
                   "tags": ["terminal"], "event_count_tag": "eventos_correlacionados"},
        "operations": [{"sortorder": 1, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW,
                        "filter": {"evaltype": 0, "conditions": [tag("recurso", "reinicio")]}}],
    },
    {
        "name": "Aeropuerto: demoras repetidas", "sortorder": 21, "status": 0, "stop": 0, "window_type": WINDOW_PATTERN,
        "description": "Tres vuelos demorados en la ventana: un solo problema operativo en lugar de tres alertas.",
        "filter": {"evaltype": 0, "conditions": [DE_LA_DEMO, tag("tipo", "demora")]},
        "window": {"duration": "15m", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 1,
                   "tags": ["tipo"], "script": SCRIPT_DEMORAS},
        "operations": [
            op(1, WHEN_PATTERN, OP_SET_NAME, ANCLA, event_name="Demoras repetidas: patrón operativo en la terminal"),
            op(2, WHEN_PATTERN, OP_SET_SEVERITY, ANCLA, severity=HIGH),
            op(3, WHEN_PATTERN, OP_SUPPRESS, [*ORIGINAL_ABIERTO, cond(COND_SUPPRESSED, NO), tag("ancla", "no")], suppress_duration="1h"),
        ],
    },
    {
        "name": "Aeropuerto: vuelo sin reporte de salida", "sortorder": 22, "status": 0, "stop": 0, "window_type": WINDOW_PATTERN,
        "description": "Embarque cerrado y salida ausente: un solo problema, con el motivo a la vista.",
        "filter": {"evaltype": 0, "conditions": [DE_LA_DEMO, cond(COND_TAG, EQUAL, tag="flujo")]},
        "window": {"duration": "15m", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 1,
                   "tags": ["vuelo"], "script": SCRIPT_AUSENTE},
        "operations": [
            op(1, WHEN_PATTERN, OP_ADD_TAG, AUSENTE, tag="detectado", tag_value="evento_ausente"),
            op(2, WHEN_PATTERN, OP_SUPPRESS, EMBARQUE_ABIERTO, suppress_duration="1h"),
        ],
    },
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
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "aeropuerto")
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
    fijar_macro(api, t[TEMPLATE_KPI], "{$AERO.NS}", ns)
    fijar_macro(api, t[TEMPLATE_APM], "{$AERO.NS}", ns)
    fijar_macro(api, hid, "{$APM.NAMESPACE.MATCHES}", f"^{ns}$")
    print(f"OK macros de ClickHouse y namespace {ns}")

    for regla in REGLAS:
        r = api("ceprule.get", {"output": ["cep_ruleid"], "filter": {"name": [regla["name"]]}})
        if r:
            api("ceprule.update", [{"cep_ruleid": r[0]["cep_ruleid"], **regla}])
            print(f"OK regla '{regla['name']}' actualizada")
        else:
            api("ceprule.create", [regla])
            print(f"OK regla '{regla['name']}' creada")


if __name__ == "__main__":
    main()
