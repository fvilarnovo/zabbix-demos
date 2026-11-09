# Plantilla de demo Zabbix 8.0

Demo mínima y funcional: un solo contenedor con una app FastAPI instrumentada con OpenTelemetry (trazas al
proxy APM de Zabbix) y el provisioning de Zabbix al arrancar. Se despliega con Dokploy junto al stack de Zabbix.
Las piezas genéricas (`supervisor.py`, `zbx_sender.py`, `zabbix_api.py`, `provision/provisionar.py`) son copias de
`comun/`: no las edites aquí, cámbialas en `comun/`.

## Crear una demo nueva

Desde la raíz del repositorio:

    ./nueva_demo.sh mi-demo

Crea `demos/mi-demo/` con `PLANTILLA` sustituido por `mi-demo` y las piezas de `comun/` actualizadas.

## Qué rellenar

Busca `TODO` en la demo nueva:

- `app/main.py`: la app real (o añade más procesos en `procesos.json`: simuladores, cargas...).
- `procesos.json`: tabla de procesos que lanza el supervisor (`nombre`, `cmd`, `cwd` y `env` opcionales; `${VAR}` del entorno).
- `provision/export/`: YAML exportados con `comun/exportar_zabbix.py` (templates, hosts, dashboards).
- `provision/post_provision.py`: pasos propios (macros, reglas CEP, usuarios).
- `.env.example` y `docker-compose.yml`: variables y puertos propios de la demo.
- `requirements.txt`: dependencias de la app.

## Probar en local sin Docker

    ESTADO_DIR=/tmp/est PROVISION=0 PROCESOS_JSON=procesos.json python3 supervisor.py

## Despliegue

Los pasos de Dokploy están en [docs/DESPLIEGUE-DOKPLOY.md](../../docs/DESPLIEGUE-DOKPLOY.md).
