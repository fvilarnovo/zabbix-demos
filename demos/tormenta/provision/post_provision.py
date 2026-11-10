#!/usr/bin/env python3
"""Pasos propios de la demo tormenta, después de importar los YAML: macros de entorno y reglas CEP. Idempotente.

Reglas CEP (no entran por import, se crean o actualizan por nombre):
  1. Causa y síntomas por exposición al clima espacial: agrupa los triggers con el tag exposicion=clima-espacial,
     del satélite y de la planta. El primer evento de la ventana es la causa (el índice Kp llega siempre primero).
  2. Causa y síntomas en la piscina: agrupa los triggers con el tag circuito=piscina. La falla de la bomba no entra en
     la regla 1, porque no está expuesta al clima espacial.
El evento de control recurso=reinicio cierra las dos ventanas, para que una falla nueva no quede como síntoma de la anterior.
Solo usa tags propios (demo, exposicion, circuito, recurso): dominio y capa son de las reglas de la planta del laboratorio.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # zabbix_api.py está en /srv
from zabbix_api import crear_api  # noqa: E402

# Constantes de CCepRuleHelper / defines.inc.php (Zabbix 8.0)
WINDOW_CAUSE_SYMPTOM = 2
WHEN_ADDED = 1
OP_CLOSE_WINDOW = 18
COND_TAG, COND_TAG_VALUE = 25, 26
EQUAL = 0
SECRETA = 1

TEMPLATE_KPI = "Tormenta KPIs by ClickHouse"
TEMPLATE_APM = "Tormenta APM by Telemetry query"
HOST_DISCOVERY = "Tormenta - APM discovery"


def cond(tipo, operador, **kw):
    return {"type": tipo, "operator": operador, **kw}


def tag(nombre, valor):
    return cond(COND_TAG_VALUE, EQUAL, tag=nombre, tag_value=valor)


DE_LA_DEMO = tag("demo", "tormenta")
CERRAR_CON_REINICIO = [{"sortorder": 1, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW,
                        "filter": {"evaltype": 0, "conditions": [tag("recurso", "reinicio")]}}]


def regla(nombre, orden, etiqueta, descripcion):
    return {
        "name": nombre, "sortorder": orden, "status": 0, "stop": 0, "window_type": WINDOW_CAUSE_SYMPTOM,
        "description": descripcion,
        "filter": {"evaltype": 0, "conditions": [DE_LA_DEMO, cond(COND_TAG, EQUAL, tag=etiqueta)]},
        "window": {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0, "group_by_tags": 1,
                   "tags": [etiqueta], "event_count_tag": "eventos_correlacionados"},
        "operations": CERRAR_CON_REINICIO,
    }


REGLAS = [
    regla("Tormenta: causa y síntomas por clima espacial", 30, "exposicion",
          "Los equipos expuestos al clima espacial, del satélite y de la planta: el primer evento es la causa y los siguientes, sus síntomas."),
    regla("Tormenta: causa y síntomas en la piscina", 31, "circuito",
          "El circuito de enfriamiento de la piscina de combustible: la bomba es la causa y la temperatura, su síntoma."),
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
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "tormenta")
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
    fijar_macro(api, t[TEMPLATE_KPI], "{$TOR.NS}", ns)
    fijar_macro(api, t[TEMPLATE_APM], "{$TOR.NS}", ns)
    fijar_macro(api, hid, "{$APM.NAMESPACE.MATCHES}", f"^{ns}$")
    print(f"OK macros de ClickHouse y namespace {ns}")

    for r in REGLAS:
        existente = api("ceprule.get", {"output": ["cep_ruleid"], "filter": {"name": [r["name"]]}})
        if existente:
            api("ceprule.update", [{"cep_ruleid": existente[0]["cep_ruleid"], **r}])
            print(f"OK regla '{r['name']}' actualizada")
        else:
            api("ceprule.create", [r])
            print(f"OK regla '{r['name']}' creada")


if __name__ == "__main__":
    main()
