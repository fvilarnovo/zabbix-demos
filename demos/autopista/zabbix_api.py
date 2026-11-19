"""Cliente mínimo de la API JSON-RPC de Zabbix 8.0, solo con la biblioteca estándar."""
import json
import ssl
import time
import urllib.request


def _contexto(url):
    return ssl._create_unverified_context() if url.startswith("https") else None


def crear_api(url, token, timeout=120):
    """Devuelve api(method, params) que lanza RuntimeError si Zabbix responde con error."""
    ctx = _contexto(url)

    def api(method, params):
        req = urllib.request.Request(
            url, data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(),
            headers={"Content-Type": "application/json-rpc", "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as r:
            resp = json.load(r)
        if "error" in resp:
            e = resp["error"]
            raise RuntimeError(f"{method}: {e.get('message')} {e.get('data')}")
        return resp["result"]
    return api


def version(url):
    """Versión de la API. apiinfo.version se llama sin autenticación."""
    req = urllib.request.Request(
        url, data=json.dumps({"jsonrpc": "2.0", "method": "apiinfo.version", "params": [], "id": 1}).encode(),
        headers={"Content-Type": "application/json-rpc"})
    with urllib.request.urlopen(req, context=_contexto(url), timeout=15) as r:
        resp = json.load(r)
    if "result" not in resp:
        raise RuntimeError(str(resp.get("error")))
    return resp["result"]


def esperar_api(url, espera_seg):
    """Reintenta apiinfo.version cada 5 s hasta espera_seg. Exige Zabbix 8.x. Devuelve la versión."""
    fin = time.time() + espera_seg
    while True:
        try:
            v = version(url)
            break
        except Exception as e:  # la API todavía no arranca
            if time.time() >= fin:
                raise RuntimeError(f"La API no respondió en {espera_seg} s ({url}): {e}")
            print(f"[api] .. esperando la API ({str(e)[:80]})", flush=True)
            time.sleep(5)
    if not v.startswith("8."):
        raise RuntimeError(f"Se requiere Zabbix 8.x y la API reporta {v}")
    return v
