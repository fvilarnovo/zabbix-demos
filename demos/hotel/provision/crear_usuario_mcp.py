#!/usr/bin/env python3
"""Usuario de solo lectura para el MCP en el escenario (Zabbix 8.0). Idempotente.

Uso (en la VM, con un token de Super admin):
  ZABBIX_API_TOKEN=xxxx python3 crear_usuario_mcp.py [https://127.0.0.1/api_jsonrpc.php]

Crea el rol, el grupo y el usuario demo-hotel, con lectura solo en los grupos del hotel y sin acceso a la interfaz web.
Lo único que puede modificar son los comentarios de problemas.
El token nuevo queda en $MCP_TOKEN_FILE (por defecto /root/.zabbix_mcp_demo_token, permisos 600): nunca se imprime, y cada corrida lo regenera.
La contraseña es aleatoria y no se guarda: este usuario solo entra por API.
Al terminar comprueba, con el token nuevo, qué ve y qué se le niega.
"""
import json
import os
import pathlib
import secrets
import ssl
import sys
import urllib.error
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "https://127.0.0.1/api_jsonrpc.php"
TOKEN = os.environ.get("ZABBIX_API_TOKEN")
CTX = ssl._create_unverified_context()

ROL = "Hotel demo (solo lectura)"
GRUPO_USUARIOS = "Hotel demo"
USUARIO = "demo-hotel"
NOMBRE_TOKEN = "MCP escenario"
ARCHIVO_TOKEN = pathlib.Path(os.environ.get("MCP_TOKEN_FILE") or "/root/.zabbix_mcp_demo_token")
GRUPOS_LECTURA = ["Hotel/Negocio", "Hotel/OT", "Hotel/Cloud", "Applications/APM/hotel"]

TIPO_USUARIO = 1
GUI_DESHABILITADA = 3
PERMISO_LECTURA = 2
ACCION_RECONOCER = 2
ACCIONES_NEGADAS = ["edit_dashboards", "edit_maps", "acknowledge_problems", "suppress_problems", "close_problems",
                    "change_severity", "execute_scripts", "manage_api_tokens", "invoke_execute_now",
                    "change_problem_ranking", "edit_own_media"]


def llamar(token, method, params):
    req = urllib.request.Request(
        URL,
        data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.load(r)


def api(method, params):
    resp = llamar(TOKEN, method, params)
    if "error" in resp:
        raise SystemExit(f"!! {method}: {resp['error'].get('data')}")
    return resp["result"]


def asegurar_rol():
    # Lee por API y solo puede comentar problemas. actions.default_access no basta: cada acción se niega por nombre.
    reglas = {"ui.default_access": 0, "api.access": 1, "api.mode": 0, "actions.default_access": 0,
              "actions": [{"name": a, "status": 0} for a in ACCIONES_NEGADAS] + [{"name": "add_problem_comments", "status": 1}]}
    r = api("role.get", {"output": ["roleid"], "filter": {"name": [ROL]}})
    if r:
        api("role.update", {"roleid": r[0]["roleid"], "rules": reglas})
        return r[0]["roleid"]
    return api("role.create", {"name": ROL, "type": TIPO_USUARIO, "rules": reglas})["roleids"][0]


def asegurar_grupo():
    grupos = api("hostgroup.get", {"output": ["groupid", "name"], "filter": {"name": GRUPOS_LECTURA}})
    faltan = set(GRUPOS_LECTURA) - {g["name"] for g in grupos}
    if faltan:
        raise SystemExit(f"!! Faltan grupos de hosts: {sorted(faltan)}")
    rights = [{"id": g["groupid"], "permission": PERMISO_LECTURA} for g in grupos]
    g = api("usergroup.get", {"output": ["usrgrpid"], "filter": {"name": [GRUPO_USUARIOS]}})
    if g:
        api("usergroup.update", {"usrgrpid": g[0]["usrgrpid"], "gui_access": GUI_DESHABILITADA, "hostgroup_rights": rights})
        return g[0]["usrgrpid"]
    return api("usergroup.create", {"name": GRUPO_USUARIOS, "gui_access": GUI_DESHABILITADA,
                                    "hostgroup_rights": rights})["usrgrpids"][0]


def asegurar_usuario(roleid, usrgrpid):
    u = api("user.get", {"output": ["userid"], "filter": {"username": [USUARIO]}})
    if u:
        api("user.update", {"userid": u[0]["userid"], "roleid": roleid, "usrgrps": [{"usrgrpid": usrgrpid}]})
        return u[0]["userid"]
    return api("user.create", {"username": USUARIO, "passwd": secrets.token_urlsafe(32), "roleid": roleid,
                               "usrgrps": [{"usrgrpid": usrgrpid}]})["userids"][0]


def regenerar_token(userid):
    t = api("token.get", {"output": ["tokenid"], "userids": [userid], "filter": {"name": [NOMBRE_TOKEN]}})
    tokenid = t[0]["tokenid"] if t else api("token.create", {"name": NOMBRE_TOKEN, "userid": userid})["tokenids"][0]
    token = api("token.generate", [tokenid])[0]["token"]
    ARCHIVO_TOKEN.parent.mkdir(parents=True, exist_ok=True)
    ARCHIVO_TOKEN.touch(mode=0o600)
    ARCHIVO_TOKEN.chmod(0o600)
    ARCHIVO_TOKEN.write_text(token)
    return token


def comprobar(token):
    hosts = llamar(token, "host.get", {"output": ["host"]}).get("result", [])
    print(f"Hosts visibles ({len(hosts)}): {sorted(h['host'] for h in hosts)}")
    ajenos = [h["host"] for h in hosts if h["host"] not in ("AWS Cost", "Google Cloud Cost")
              and "hotel" not in h["host"].lower()]
    print("BIEN: solo ve hosts del hotel" if not ajenos else f"MAL: ve hosts ajenos: {ajenos}")

    negado = llamar(token, "maintenance.create", {
        "name": "prueba de permisos", "active_since": 1893456000, "active_till": 1893459600,
        "hosts": [{"hostid": hosts[0]["hostid"]}] if hosts else [],
        "timeperiods": [{"period": 3600}]})
    print("BIEN: crear mantenimiento negado" if "error" in negado else "MAL: pudo crear un mantenimiento")

    eventos = llamar(token, "event.get", {"output": ["eventid"], "limit": 1, "sortfield": "eventid", "sortorder": "DESC",
                                          "value": 1}).get("result", [])
    if not eventos:
        print("SIN COMPROBAR: no hay eventos visibles para intentar reconocer")
        return
    reconocer = llamar(token, "event.acknowledge", {"eventids": eventos[0]["eventid"], "action": ACCION_RECONOCER})
    print("BIEN: reconocer problemas negado" if "error" in reconocer else "MAL: pudo reconocer un problema")


def main():
    if not TOKEN:
        raise SystemExit("Falta ZABBIX_API_TOKEN")
    token = regenerar_token(asegurar_usuario(asegurar_rol(), asegurar_grupo()))
    print(f"OK usuario '{USUARIO}'; token en {ARCHIVO_TOKEN}")
    comprobar(token)


if __name__ == "__main__":
    main()
