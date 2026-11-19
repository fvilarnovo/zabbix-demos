"""Cliente mínimo del protocolo de Zabbix Trapper (ZBXD), sin depender del binario zabbix_sender."""
import json
import socket
import struct

# Nombres habituales del servicio Zabbix server en los stacks Docker/Dokploy. Si el configurado no resuelve
# (p. ej. ZABBIX_TRAPPER_HOST=zabbix-server pero el servicio se llama zabbix-server-pgsql), se prueban estos.
CANDIDATOS_SERVER = ["zabbix-server", "zabbix-server-pgsql", "zabbix-server-mysql", "zabbix_server", "server"]


def resuelve(nombre):
    try:
        socket.getaddrinfo(nombre, None)
        return True
    except OSError:
        return False


def resolver_trapper(host):
    """Devuelve host si resuelve; si no, el primer candidato conocido que resuelva; si ninguno, None."""
    if resuelve(host):
        return host
    for candidato in CANDIDATOS_SERVER:
        if candidato != host and resuelve(candidato):
            return candidato
    return None


class ZabbixSender:
    def __init__(self, server="127.0.0.1", port=10051, timeout=10.0):
        self.configurado = server
        self.server = server
        self.port = port
        self.timeout = timeout
        self._avisado = None

    def _destino(self):
        """Resuelve el destino en cada envío: si el nombre deja de existir, cae a un candidato que sí exista."""
        destino = resolver_trapper(self.configurado)
        if destino and destino != self.configurado and destino != self._avisado:
            print(f"[trapper] '{self.configurado}' no resuelve; se usa '{destino}'. "
                  f"Fija ZABBIX_TRAPPER_HOST={destino} para evitar este aviso.", flush=True)
            self._avisado = destino
        return destino

    def send_batch(self, metrics):
        """Envía una lista de {host, key, value, clock}. Devuelve (ok, texto de respuesta del servidor)."""
        destino = self._destino()
        if destino is None:
            return False, (f"El nombre '{self.configurado}' no resuelve en la red Docker y ninguno de "
                           f"{CANDIDATOS_SERVER} tampoco. Fija ZABBIX_TRAPPER_HOST con el nombre del servicio "
                           f"Zabbix server del stack (docker network inspect <ZABBIX_NETWORK>) o su IP.")
        self.server = destino
        cuerpo = json.dumps({"request": "sender data", "data": metrics}).encode("utf-8")
        paquete = b"ZBXD\x01" + struct.pack("<Q", len(cuerpo)) + cuerpo
        try:
            with socket.create_connection((self.server, self.port), timeout=self.timeout) as sock:
                sock.sendall(paquete)
                cabecera = sock.recv(13)
                if len(cabecera) < 13 or cabecera[:5] != b"ZBXD\x01":
                    return False, f"Cabecera inválida del servidor: {cabecera!r}"
                largo = struct.unpack("<Q", cabecera[5:13])[0]
                datos = b""
                while len(datos) < largo:
                    trozo = sock.recv(min(4096, largo - len(datos)))
                    if not trozo:
                        break
                    datos += trozo
            respuesta = json.loads(datos.decode("utf-8"))
        except (OSError, ValueError) as e:
            return False, f"Sin conexión con {self.server}:{self.port}: {e}"
        if respuesta.get("response") == "success":
            return True, respuesta.get("info", "")
        return False, f"Error de Zabbix: {respuesta}"
