#!/usr/bin/env python3
"""Pasos propios de la demo estadio, después de importar los YAML: macros de entorno y reglas CEP. Idempotente.

Reglas CEP (no entran por import, se crean o actualizan por nombre). Cada una agrupa los triggers que comparten un tag
y toma el primer evento de la ventana como causa:
  1. Alimentación eléctrica (tag alimentacion): el corte de la red es la causa; UPS, reflectores, cartelería LED,
     pantalla gigante, TVs y publicidad son sus síntomas.
  2. Ingreso del público (tag flujo): la base de entradas es la causa; rechazos en los molinetes, ingreso detenido,
     fila larga y errores de APM en accesos y boletería son sus síntomas.
  3. Circuito comercial (tag circuito): el interruptor del tablero comercial es la causa; las terminales de cobro,
     las ventas y los errores de APM de la tienda son sus síntomas.
Cada ventana tiene su propio evento de control recurso=reinicio, que la cierra para que una falla nueva no quede como
síntoma de la anterior. Un solo evento con los tres tags no sirve: solo cierra la ventana de la primera regla que lo recibe.
Solo usa tags propios (demo, alimentacion, flujo, circuito, recurso): dominio y capa son de las reglas de la planta del laboratorio.
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

TEMPLATE_KPI = "Estadio KPIs by ClickHouse"
TEMPLATE_APM = "Estadio APM by Telemetry query"
HOST_DISCOVERY = "Estadio - APM discovery"


def cond(tipo, operador, **kw):
    return {"type": tipo, "operator": operador, **kw}


def tag(nombre, valor):
    return cond(COND_TAG_VALUE, EQUAL, tag=nombre, tag_value=valor)


DE_LA_DEMO = tag("demo", "estadio")
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
    regla("Estadio: causa y síntomas por alimentación eléctrica", 40, "alimentacion",
          "Lo que depende de la red eléctrica del estadio: el primer evento es la causa y los siguientes, sus síntomas."),
    regla("Estadio: causa y síntomas en el ingreso del público", 41, "flujo",
          "La cadena de ingreso: base de entradas, molinetes y fila. La base es la causa; el resto, sus síntomas."),
    regla("Estadio: causa y síntomas en el circuito comercial", 42, "circuito",
          "El circuito comercial: el interruptor del tablero es la causa; la tienda sin cobro y sin ventas, sus síntomas."),
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
    ns = os.environ.get("OTEL_SERVICE_NAMESPACE", "estadio")
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
    fijar_macro(api, t[TEMPLATE_KPI], "{$EST.NS}", ns)
    fijar_macro(api, t[TEMPLATE_APM], "{$EST.NS}", ns)
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
