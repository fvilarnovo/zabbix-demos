# zabbix-demos

Paquetes de demos de Zabbix 8.0 para desplegar con Dokploy como proyectos Compose.

Cada demo vive en `demos/<nombre>/` y trae:

- `docker-compose.yml`: los servicios de la demo.
- `.env.example`: las variables, para pegar en Dokploy → Environment.
- `README.md`: la guía de despliegue de esa demo.

Las demos no incluyen Zabbix. Se unen a la red Docker de un stack de Zabbix 8.0 ya desplegado: server, frontend, proxy con colector APM, ClickHouse y MCP server.

## Demos disponibles

| Demo | Qué muestra |
|---|---|
| [`demos/hotel/`](demos/hotel/README.md) | Hotel Gran Zabbix 8.0, en un solo contenedor: webapp instrumentada (APM y KPI), simuladores OT con correlación CEP, FinOps, vista pixel art y controles de los actos |

## Agregar otra demo

1. Crea `demos/<nombre>/` con `docker-compose.yml`, `.env.example` y `README.md`.
2. En el Compose, usa `networks.default.external` con el nombre de red en la variable `ZABBIX_NETWORK`.
3. Documenta en el README los pasos de Dokploy, las variables y la verificación.
4. Agrega la demo a la tabla de arriba.
