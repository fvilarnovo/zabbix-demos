# zabbix-demos

Paquetes de demos de Zabbix 8.0 para desplegar con Dokploy como proyectos Compose.

Cada demo vive en `demos/<nombre>/` y trae:

- `docker-compose.yml`: los servicios de la demo.
- `.env.example`: las variables, para pegar en Dokploy → Environment.
- `README.md`: la guía de despliegue de esa demo.

Las demos no incluyen Zabbix. Se unen a la red Docker de un stack de Zabbix 8.0 ya desplegado: server, frontend, proxy con colector APM, ClickHouse y MCP server. Cada demo es un solo contenedor: un supervisor provisiona Zabbix al arrancar y lanza los procesos de la demo.

Además del catálogo de demos, el repositorio trae:

- `docs/DESPLIEGUE-DOKPLOY.md`: el procedimiento de despliegue en Dokploy paso a paso, con los errores conocidos.
- `comun/`: las piezas genéricas (supervisor, cliente trapper, cliente de API, provisioning e exportación de Zabbix).
- `demos/_plantilla/` y `nueva_demo.sh`: el punto de partida para una demo nueva.

## Demos disponibles

| Demo | Qué muestra |
|---|---|
| [`demos/hotel/`](demos/hotel/README.md) | Hotel Gran Zabbix 8.0, en un solo contenedor: webapp instrumentada (APM y KPI), simuladores OT con correlación CEP, FinOps, vista pixel art y controles de los actos |
| [`demos/aeropuerto/`](demos/aeropuerto/README.md) | Aeropuerto Forum: terminal aérea en 3D donde se provocan fallas para ver OT, CEP y APM de Zabbix 8.0 sobre datos simulados y trazas reales |

## Agregar otra demo

```bash
./nueva_demo.sh <nombre>
```

Crea `demos/<nombre>/` desde la plantilla, con las piezas de `comun/` en su versión actual y una app mínima instrumentada que ya envía trazas. Después:

1. Reemplaza la app de ejemplo por la de la demo y ajusta `procesos.json` (un proceso por servicio o simulador).
2. Exporta su configuración de Zabbix con `comun/exportar_zabbix.py` a `provision/export/`; los pasos propios (macros, reglas CEP, usuarios) van en `provision/post_provision.py`.
3. Completa `.env.example` y el `README.md` de la demo.
4. Despliega siguiendo `docs/DESPLIEGUE-DOKPLOY.md` y agrega la demo a la tabla de arriba.
