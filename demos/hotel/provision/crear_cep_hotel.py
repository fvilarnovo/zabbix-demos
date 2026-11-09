#!/usr/bin/env python3
"""Host OT del hotel y reglas CEP de la demo (Zabbix 8.0). Idempotente: crea o actualiza por nombre.

Uso (en la VM):
  ZABBIX_API_TOKEN=xxxx python3 crear_cep_hotel.py [https://127.0.0.1/api_jsonrpc.php]

1. "Hotel: causa y síntomas de energía" (Cause and symptoms grouping, ventana por el tag circuito):
   el primer evento de la ventana es la causa y los demás, sus síntomas. El elevador 1 está en otro circuito
   (emergencia), así que no entra en el grupo: es el control negativo de la demo.
   Las ventanas cierran en límites fijos de reloj (inicio + k × duración), no a partir del primer evento: un corte que
   cruza un límite se parte en dos. Por eso dura 1 h, y el evento de control "reinicio" la cierra antes de cada corte;
   sin eso, un corte nuevo quedaría como síntoma del anterior.
2. "Hotel: incidente eléctrico" (pattern match): con energía y al menos dos servicios abiertos en el circuito principal,
   el evento de la red pasa a ser el incidente, con severidad Disaster.
"""
import json
import os
import ssl
import sys
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "https://127.0.0.1/api_jsonrpc.php"
TOKEN = os.environ.get("ZABBIX_API_TOKEN")
CTX = ssl._create_unverified_context()

# Constantes de la API (CCepRuleHelper / defines.inc.php, Zabbix 8.0)
WINDOW_CAUSE_SYMPTOM, WINDOW_PATTERN = 2, 4
WHEN_ADDED, WHEN_PATTERN = 1, 4
OP_SET_NAME, OP_SET_SEVERITY, OP_CLOSE_WINDOW = 1, 4, 18
SCOPE_ALL_EVENTS = 2
COND_TAG_VALUE, COND_EVENT_OPEN, COND_COPIED = 26, 30, 34
EQUAL, YES, NO = 0, 10, 11
TRAPPER, FLOAT, UNSIGNED = 2, 0, 3
NOT_CLASSIFIED, WARNING, AVERAGE, HIGH, DISASTER = 0, 2, 3, 4, 5

GRUPO = "Hotel/OT"
HOST = "Hotel Gran Forum - OT"
SITIO = "gran-forum"
INCIDENTE = "Incidente eléctrico: el hotel perdió el suministro de red"

MAPAS = {
    "Hotel: red": {0: "Sin suministro", 1: "Con suministro"},
    "Hotel: origen": {0: "Red", 1: "Batería"},
    "Hotel: generador": {0: "Parado", 1: "Arrancando", 2: "En marcha", 3: "Falla"},
    "Hotel: chiller": {0: "Detenido", 1: "En marcha"},
    "Hotel: elevador": {0: "Fuera de servicio", 1: "En servicio"},
}

# clave, nombre, tipo, unidades, recurso, mapa de valores
ITEMS = [
    ("hotel.grid.state", "Hotel: Red eléctrica (1=ok)", UNSIGNED, "", "red", "Hotel: red"),
    ("hotel.grid.voltage", "Hotel: Tensión de red", FLOAT, "V", "red", None),
    ("hotel.ups.on_battery", "Hotel: UPS en batería (1=sí)", UNSIGNED, "", "ups", "Hotel: origen"),
    ("hotel.ups.battery_pct", "Hotel: Carga de batería de la UPS", FLOAT, "%", "ups", None),
    ("hotel.ups.runtime_min", "Hotel: Autonomía de la UPS en minutos", FLOAT, "min", "ups", None),
    ("hotel.ups.load_pct", "Hotel: Carga de salida de la UPS", FLOAT, "%", "ups", None),
    ("hotel.gen.state", "Hotel: Generador (0=parado, 1=arrancando, 2=en marcha, 3=falla)", UNSIGNED, "", "generador",
     "Hotel: generador"),
    ("hotel.gen.fuel_pct", "Hotel: Combustible del generador", FLOAT, "%", "generador", None),
    ("hotel.gen.start_battery_v", "Hotel: Batería de arranque del generador (mínimo 11.5 V)", FLOAT, "V", "generador", None),
    ("hotel.hvac.chiller_state", "Hotel: Chiller (1=en marcha)", UNSIGNED, "", "hvac", "Hotel: chiller"),
    ("hotel.hvac.supply_temp", "Hotel: Temperatura de agua del chiller", FLOAT, "°C", "hvac", None),
    ("hotel.hvac.lobby_temp", "Hotel: Temperatura del lobby", FLOAT, "°C", "hvac", None),
    ("hotel.elev.state[1]", "Hotel: Elevador 1 (1=en servicio)", UNSIGNED, "", "elevador", "Hotel: elevador"),
    ("hotel.elev.state[2]", "Hotel: Elevador 2 (1=en servicio)", UNSIGNED, "", "elevador", "Hotel: elevador"),
    ("hotel.elev.state[3]", "Hotel: Elevador 3 (1=en servicio)", UNSIGNED, "", "elevador", "Hotel: elevador"),
    ("hotel.wifi.aps_up", "Hotel: Puntos de acceso Wi-Fi activos (de 48)", UNSIGNED, "", "wifi", None),
    ("hotel.wifi.clients", "Hotel: Clientes Wi-Fi conectados", UNSIGNED, "", "wifi", None),
    ("hotel.cep.reinicio", "Control: reinicio de ventanas CEP", UNSIGNED, "", "reinicio", None),
]

# descripción, expresión, severidad, recurso, capa, circuito
TRIGGERS = [
    ("Red eléctrica: sin suministro", "last(/{h}/hotel.grid.state)=0", HIGH, "red", "energia", "principal"),
    ("UPS en batería", "last(/{h}/hotel.ups.on_battery)=1", AVERAGE, "ups", "energia", "principal"),
    ("UPS: autonomía baja", "last(/{h}/hotel.ups.runtime_min)<10", HIGH, "ups", "energia", "principal"),
    ("Generador: falla de arranque", "last(/{h}/hotel.gen.state)=3", HIGH, "generador", "energia", "principal"),
    ("Aire acondicionado: chiller detenido", "last(/{h}/hotel.hvac.chiller_state)=0", HIGH, "hvac", "servicio", "principal"),
    ("Lobby: temperatura alta", "last(/{h}/hotel.hvac.lobby_temp)>26", WARNING, "hvac", "servicio", "principal"),
    ("Elevador 2 fuera de servicio", "last(/{h}/hotel.elev.state[2])=0", AVERAGE, "elevador", "servicio", "principal"),
    ("Elevador 3 fuera de servicio", "last(/{h}/hotel.elev.state[3])=0", AVERAGE, "elevador", "servicio", "principal"),
    ("Wi-Fi: la mayoría de los puntos de acceso caídos", "last(/{h}/hotel.wifi.aps_up)<24", HIGH, "wifi", "servicio", "principal"),
    ("Elevador 1 fuera de servicio", "last(/{h}/hotel.elev.state[1])=0", AVERAGE, "elevador", "servicio", "emergencia"),
    ("Control: reinicio de ventana principal", "last(/{h}/hotel.cep.reinicio)=1", NOT_CLASSIFIED, "reinicio", "control", "principal"),
    ("Control: reinicio de ventana de emergencia", "last(/{h}/hotel.cep.reinicio)=1", NOT_CLASSIFIED, "reinicio", "control", "emergencia"),
]

SCRIPT = r"""
var ev = cep_get_events();
function tiene(e, tag, value) {
    for (var i = 0; i < e.tags.length; i++) {
        if (e.tags[i].tag === tag && e.tags[i].value === value) { return true; }
    }
    return false;
}
var energia = false, servicios = 0;
for (var i = 0; i < ev.length; i++) {
    if (ev[i].is_copied || !ev[i].is_open) { continue; }
    if (tiene(ev[i], 'recurso', 'red')) { energia = true; }
    if (tiene(ev[i], 'capa', 'servicio')) { servicios++; }
}
return energia && servicios >= 2;
"""


def cond(type_, operator, **kw):
    return {"type": type_, "operator": operator, **kw}


del_sitio = cond(COND_TAG_VALUE, EQUAL, tag="sitio", tag_value=SITIO)
del_principal = cond(COND_TAG_VALUE, EQUAL, tag="circuito", tag_value="principal")
la_red_abierta = [cond(COND_COPIED, NO), cond(COND_EVENT_OPEN, YES), cond(COND_TAG_VALUE, EQUAL, tag="recurso", tag_value="red")]


def op(sortorder, type_, **kw):
    # filter se evalúa contra el evento que completó el patrón, y ese puede ser cualquiera de la ventana.
    # scope_filter elige sobre qué eventos se aplica la operación: sin él, serían todos.
    return {"sortorder": sortorder, "execute_when": WHEN_PATTERN, "type": type_, "scope": SCOPE_ALL_EVENTS,
            "scope_filter": {"evaltype": 0, "conditions": la_red_abierta}, **kw}


REGLAS = [
    {
        "name": "Hotel: causa y síntomas de energía", "sortorder": 10, "status": 0, "stop": 0,
        "window_type": WINDOW_CAUSE_SYMPTOM,
        "description": "El primer evento del circuito es la causa; los siguientes, sus síntomas, hasta que un evento de control cierre la ventana.",
        "filter": {"evaltype": 0, "conditions": [del_sitio]},
        "window": {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0,
                   "group_by_tags": 1, "tags": ["circuito"], "event_count_tag": "eventos_correlacionados"},
        "operations": [{"sortorder": 1, "execute_when": WHEN_ADDED, "type": OP_CLOSE_WINDOW, "filter": {
            "evaltype": 0, "conditions": [cond(COND_TAG_VALUE, EQUAL, tag="recurso", tag_value="reinicio")]}}],
    },
    {
        "name": "Hotel: incidente eléctrico", "sortorder": 11, "status": 0, "stop": 0, "window_type": WINDOW_PATTERN,
        "description": "Sin red y con al menos dos servicios caídos en el circuito principal: un solo incidente de máxima severidad.",
        "filter": {"evaltype": 0, "conditions": [del_sitio, del_principal]},
        "window": {"duration": "1h", "capacity": "0", "group_by_host_group": 0, "group_by_host": 0,
                   "group_by_tags": 1, "tags": ["circuito"], "script": SCRIPT},
        "operations": [op(1, OP_SET_NAME, event_name=INCIDENTE), op(2, OP_SET_SEVERITY, severity=DISASTER)],
    },
]


def api(method, params):
    req = urllib.request.Request(
        URL,
        data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {TOKEN}"},
    )
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        resp = json.load(r)
    if "error" in resp:
        raise SystemExit(f"!! {method}: {resp['error'].get('data')}")
    return resp["result"]


def asegurar_host():
    g = api("hostgroup.get", {"output": ["groupid"], "filter": {"name": [GRUPO]}})
    groupid = g[0]["groupid"] if g else api("hostgroup.create", {"name": GRUPO})["groupids"][0]
    h = api("host.get", {"output": ["hostid"], "filter": {"host": [HOST]}})
    if h:
        return h[0]["hostid"]
    return api("host.create", {"host": HOST, "groups": [{"groupid": groupid}],
                               "tags": [{"tag": "sitio", "value": SITIO}]})["hostids"][0]


def asegurar_mapas(hostid):
    ids = {}
    for nombre, valores in MAPAS.items():
        v = api("valuemap.get", {"output": ["valuemapid"], "hostids": hostid, "filter": {"name": [nombre]}})
        ids[nombre] = v[0]["valuemapid"] if v else api("valuemap.create", {
            "hostid": hostid, "name": nombre,
            "mappings": [{"value": str(k), "newvalue": t} for k, t in valores.items()],
        })["valuemapids"][0]
    return ids


def asegurar_items(hostid, mapas):
    for key, nombre, tipo, unidades, recurso, mapa in ITEMS:
        datos = {"name": nombre, "units": unidades, "valuemapid": mapas[mapa] if mapa else "0"}
        i = api("item.get", {"output": ["itemid"], "hostids": hostid, "filter": {"key_": [key]}})
        if i:
            api("item.update", {"itemid": i[0]["itemid"], **datos})
        else:
            api("item.create", {"hostid": hostid, "key_": key, "type": TRAPPER, "value_type": tipo,
                                "tags": [{"tag": "recurso", "value": recurso}], **datos})


def asegurar_triggers(hostid):
    for descripcion, expresion, severidad, recurso, capa, circuito in TRIGGERS:
        if not api("trigger.get", {"output": ["triggerid"], "hostids": hostid, "filter": {"description": [descripcion]}}):
            api("trigger.create", {
                "description": descripcion, "priority": severidad, "expression": expresion.format(h=HOST),
                "tags": [{"tag": "sitio", "value": SITIO}, {"tag": "recurso", "value": recurso},
                         {"tag": "capa", "value": capa}, {"tag": "circuito", "value": circuito}],
            })


def asegurar_reglas():
    for regla in REGLAS:
        r = api("ceprule.get", {"output": ["cep_ruleid"], "filter": {"name": [regla["name"]]}})
        if r:
            api("ceprule.update", [{"cep_ruleid": r[0]["cep_ruleid"], **regla}])
            print(f"OK regla '{regla['name']}' actualizada ({r[0]['cep_ruleid']})")
        else:
            print(f"OK regla '{regla['name']}' creada ({api('ceprule.create', [regla])['cep_ruleids'][0]})")


def main():
    if not TOKEN:
        raise SystemExit("Falta ZABBIX_API_TOKEN")
    hostid = asegurar_host()
    asegurar_items(hostid, asegurar_mapas(hostid))
    asegurar_triggers(hostid)
    print(f"OK host '{HOST}' ({hostid})")
    asegurar_reglas()


if __name__ == "__main__":
    main()
