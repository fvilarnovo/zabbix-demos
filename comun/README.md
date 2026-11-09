# comun/

Piezas genéricas (Python 3.12, solo biblioteca estándar) que comparten todas las demos. La fuente de verdad es
esta carpeta: `nueva_demo.sh` las copia a cada demo nueva, y `demos/_plantilla/` guarda copias ya hechas.
Si cambias algo aquí, vuelve a copiarlo a las demos que lo necesiten.

| Archivo | Qué es | Dónde queda en la demo |
|---|---|---|
| `supervisor.py` | Punto de entrada del contenedor. Ejecuta `provision/provisionar.py` (si existe y `PROVISION=1`) y lanza los procesos de `procesos.json` (ruta en `PROCESOS_JSON`) con prefijo `[nombre]` en los logs, relanzándolos a los 3 s si mueren. SIGTERM cierra todo. Crea `$ESTADO_DIR` (`/estado`) y `/salida`. | `supervisor.py` |
| `zbx_sender.py` | Cliente mínimo del protocolo Zabbix Trapper (`ZabbixSender.send_batch`), para simuladores. | `zbx_sender.py` |
| `zabbix_api.py` | `crear_api(url, token, timeout=120)`, `esperar_api(url, espera_seg)` y `version(url)` para la API JSON-RPC. | `zabbix_api.py` |
| `provisionar.py` | Provisioning idempotente: espera la API, fija la macro global `{$TRAPPER.ALLOWED_HOSTS}`, importa los `.yaml` de `provision/export/` (templates, hosts, dashboards, resto), ejecuta `provision/post_provision.py` si existe y escribe `/salida/resumen.json`. | `provision/provisionar.py` |
| `exportar_zabbix.py` | Herramienta de escritorio (no va al contenedor): exporta templates, hosts y dashboards de Zabbix a `templates_<demo>.yaml`, `hosts_<demo>.yaml`, `dashboards_<demo>.yaml`. | se ejecuta desde la raíz del repo |

## procesos.json

Lista de procesos que lanza el supervisor:

    [{"nombre": "app", "cmd": ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
      "cwd": "opcional, relativo a /srv", "env": {"VAR": "opcional"}}]

`cmd`, `cwd` y los valores de `env` admiten `${VAR}` del entorno del contenedor. El supervisor fija
`ESTADO_DIR=/estado` y `PYTHONUNBUFFERED=1` si no existen.

## Variables

- `provisionar.py`: `ZABBIX_URL` y `ZABBIX_API_TOKEN` (obligatorias), `TRAPPER_ALLOWED`, `DASHBOARDS_PREFIJO`
  (vacío = no listar dashboards), `ESPERA_API_SEG` (300).
- `exportar_zabbix.py`: `ZABBIX_URL`, `ZABBIX_API_TOKEN`; `--demo`, `--templates`, `--hosts`, `--dashboards`, `--salida`.
- `post_provision.py` (propio de cada demo) recibe el mismo entorno y puede importar `zabbix_api` (queda en `/srv`).

## Uso con la plantilla

    ./nueva_demo.sh mi-demo      # copia demos/_plantilla y refresca las piezas de comun/
