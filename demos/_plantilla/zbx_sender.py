"""Cliente mínimo del protocolo de Zabbix Trapper (ZBXD), sin depender del binario zabbix_sender."""
import json
import socket
import struct


class ZabbixSender:
    def __init__(self, server="127.0.0.1", port=10051, timeout=10.0):
        self.server = server
        self.port = port
        self.timeout = timeout

    def send_batch(self, metrics):
        """Envía una lista de {host, key, value, clock}. Devuelve (ok, texto de respuesta del servidor)."""
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
