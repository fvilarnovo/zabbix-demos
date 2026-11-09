# Demo Hotel Gran Zabbix 8.0

Un hotel ficticio, el Hotel Gran Forum, instrumentado con OpenTelemetry para mostrar Zabbix 8.0 en vivo. La demo es **un solo contenedor** (`hotel-demo`) que corre todo: la webapp, los simuladores, la vista pixel art, el servicio de control y el provisioning de Zabbix.

- Las trazas llegan por OTLP/gRPC al colector APM del proxy de Zabbix y se guardan en ClickHouse. Zabbix calcula KPI de negocio (visitas, reservas, consumos) a partir de ellas.
- Los simuladores OT y FinOps envían datos por el protocolo trapper, en Python puro (sin el binario `zabbix_sender`).
- La webapp muestra un banner de datos simulados.

## Qué contiene el contenedor

Un servicio `hotel-demo`, construido desde el `Dockerfile` (`python:3.12-slim`). Al arrancar, `supervisor.py`:

1. Ejecuta `provision/provisionar.py` si `PROVISION=1`. Si falla, lo registra en el log y la demo arranca igual.
2. Lanza 9 procesos y los relanza (a los 3 s) si mueren.

| Proceso | Dirección | Función |
|---|---|---|
| `reservas-api` | 127.0.0.1:8001 | API de reservas |
| `habitaciones-api` | 127.0.0.1:8002 | API de habitaciones |
| `pagos-api` | 127.0.0.1:8003 | API de pagos (simulada) |
| `hotel-web` | 0.0.0.0:8000 | Webapp |
| `carga` | - | Generador de visitantes, reservas, consumos y check-in/out |
| `sim-ot` | - | Simulador OT, envía cada 5 s |
| `sim-finops` | - | Simulador FinOps, envía cada 10 s |
| `pixel` | 0.0.0.0:8090 | Vista pixel art |
| `control` | 0.0.0.0:8091 | Servicio de control por HTTP |

Los logs salen por stdout con el prefijo `[nombre]`. Todos los procesos comparten el contenedor: reiniciarlo reinicia la demo entera (el estado persiste en el volumen).

### Puertos publicados

| Variable | Default | Contenedor | Qué es |
|---|---|---|---|
| `HOTEL_PORT` | `8088` | 8000 | Webapp (el panel `/demo` cambia el modo de fallas) |
| `PIXEL_PORT` | `8090` | 8090 | Vista pixel art; con `PIXEL_CONTROLES=1` incluye la barra de controles |
| `CONTROL_PORT` | `8091` | 8091 | Control por HTTP con `Authorization: Bearer CONTROL_TOKEN` |

### Volúmenes

| Volumen | Ruta | Contenido |
|---|---|---|
| `estado` | `/estado` | SQLite de la webapp, escenario OT, marcas de anomalía y marca de historia FinOps |
| `salida` | `/salida` | `resumen.json` del provisioning y, si `PROVISION_MCP_USER=1`, `zabbix_mcp_demo_token` |

### Simuladores

- `sim-ot` envía cada 5 s a `ZABBIX_TRAPPER_HOST:ZABBIX_TRAPPER_PORT` (default `zabbix-server:10051`).
- `sim-finops` carga `FINOPS_HISTORIA_DIAS` días de historia solo la primera vez (la marca queda en el volumen `estado`) y luego envía cada 10 s.

## Qué deja el provisioning en Zabbix

- 3 templates: "APM application by ClickHouse HTTP v3", "APM applications discovery by ClickHouse HTTP v3" y "Hotel KPIs by ClickHouse".
- 6 hosts: Hotel Gran Forum - OT, Hotel Gran Forum - Negocio, Hotel Gran Forum - FinOps, AWS Cost, Google Cloud Cost y apm-discovery-test.
- 3 dashboards: Hotel · Negocio, Hotel · Operación y Hotel · Cloud Cost.
- Reglas CEP del hotel.
- Las macros `{$CH.URL}`, `{$CH.USER}`, `{$CH.PASSWORD}` y `{$TRAPPER.ALLOWED_HOSTS}`.
- Opcional (`PROVISION_MCP_USER=1`): el usuario de solo lectura `demo-hotel` para el MCP.

Es idempotente: corre en cada arranque del contenedor. Detalle en [`provision/README.md`](provision/README.md).

## Requisitos

Stack de Zabbix 8.0 desplegado en Dokploy como Compose, con estos servicios:

| Servicio | Puerto |
|---|---|
| `zabbix-server` | 10051 (no publicado) |
| `zabbix-web` | 8080 |
| `zabbix-proxy-apm` | 4317 (OTLP/gRPC) |
| `clickhouse` | 8123 (usuario y contraseña) |
| `zabbix-mcp-server` | 8443 (por Traefik) |
| `postgres` | interno |

Como el stack no publica 10051 ni 8123, la demo se une a su red Docker (`networks.default.external`). El nombre es `<appName>_default` y va en `ZABBIX_NETWORK`. Se ve en Dokploy → Docker → Networks.

### Lo que el provisioning NO hace (hazlo a mano)

1. Registrar el proxy y activar APM: en su pestaña APM, "Data collection enabled".
2. En el frontend, Administration → Data source → APM: URL `http://clickhouse:8123`, base `zabbix`, usuario y contraseña. Habilita el menú APM nativo (Traces, Metrics, Logs).
3. Crear un token de API de un Super admin, para `ZABBIX_API_TOKEN`.

## Desplegar en Dokploy

1. Crea un proyecto.
2. Crea un servicio Compose desde el repositorio GitHub. Ruta: `demos/hotel/docker-compose.yml`.
3. En Environment, pega el contenido completo de `.env.example` y completa `ZABBIX_NETWORK`, `ZABBIX_API_TOKEN`, `CH_PASSWORD` y `CONTROL_TOKEN`. Genera el token con:
   ```bash
   openssl rand -hex 24
   ```
4. Pulsa Deploy. Dokploy construye la imagen desde el repo, no hace falta registro.
5. Opcional: en Domains, publica los puertos 8000, 8090 y 8091 del servicio `hotel-demo`.

## Variables

| Variable | Default | Descripción |
|---|---|---|
| `ZABBIX_NETWORK` | obligatoria | Red Docker del stack de Zabbix (`<appName>_default`) |
| `ZABBIX_URL` | obligatoria | API de Zabbix, p. ej. `http://zabbix-web:8080/api_jsonrpc.php` |
| `ZABBIX_API_TOKEN` | obligatoria | Token de un Super admin |
| `CONTROL_TOKEN` | obligatoria | Token Bearer del servicio de control |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | obligatoria (`.env.example`: `http://zabbix-proxy-apm:4317`) | Destino de las trazas |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | Usa `http/protobuf` con un OpenTelemetry Collector en el puerto 4318 |
| `OTEL_SERVICE_NAMESPACE` | `hotel` | Namespace de los servicios. Uno por despliegue |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `production` | Entorno. El discovery crea `apm-<namespace>-<entorno>` |
| `ZABBIX_TRAPPER_HOST` | `zabbix-server` | Destino de los simuladores |
| `ZABBIX_TRAPPER_PORT` | `10051` | Puerto trapper |
| `PROVISION` | `1` | `0` = no tocar Zabbix al arrancar |
| `PROVISION_MCP_USER` | `0` | `1` crea el usuario `demo-hotel` de solo lectura para el MCP |
| `CH_URL` | `http://clickhouse:8123/` | ClickHouse tal como lo ve el Zabbix server |
| `CH_USER` | `zabbix` | Usuario de ClickHouse |
| `CH_PASSWORD` | vacío | Contraseña de ClickHouse |
| `TRAPPER_ALLOWED` | `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | Subredes que pueden enviar a los ítems trapper |
| `PIXEL_CONTROLES` | `1` | `1` = la barra de la vista pixel dispara los actos; `0` = solo mirar |
| `FINOPS_HISTORIA_DIAS` | `7` | Días de historia FinOps que se cargan la primera vez |
| `HOTEL_PORT` | `8088` | Puerto del host para la webapp |
| `PIXEL_PORT` | `8090` | Puerto del host para la vista pixel |
| `CONTROL_PORT` | `8091` | Puerto del host para el control |

## Servicio de control

Rutas del puerto 8091. Todas exigen `Authorization: Bearer CONTROL_TOKEN`, salvo `/salud`.

| Ruta | Función |
|---|---|
| `GET /salud` | El control está activo (sin token) |
| `GET /check` | Comprobación previa. Con `Accept: text/plain` da líneas BIEN/MAL |
| `POST /act1/<normal\|promo\|pagos-lentos\|pagos-error>` | Acto 1: modo de la webapp |
| `POST /act2/<corte\|elevador\|normal>` | Acto 2: escenario OT |
| `POST /act3/<gcp\|aws\|normal>` | Acto 3: anomalía de costo (`normal` la quita) |
| `POST /reset` | Todo a la normalidad |

`/check` no puede comprobar el límite de la ventana CEP.

### Cliente para el presentador

`cliente/demo.sh` corre en el computador del presentador. Lee `demo.env` (junto al script) con `CONTROL_URL` y `CONTROL_TOKEN`.

```bash
cd cliente
cp demo.env.example demo.env      # editar CONTROL_URL y CONTROL_TOKEN
./demo.sh check
./demo.sh act1 promo              # normal | promo | pagos-lentos | pagos-error
./demo.sh act2 corte              # corte | elevador | normal
./demo.sh act3 gcp                # gcp | aws | normal
./demo.sh reset
```

## Verificar

1. Logs del contenedor: `[provision] terminado bien` y `[supervisor] 9 procesos en marcha`.
2. Desde el computador del presentador:
   ```bash
   ./cliente/demo.sh check
   ```
   Todo debe salir BIEN.
3. En Zabbix, Data collection → Hosts: los 6 hosts. Unos 5 min después de que haya tráfico aparece `apm-hotel-production`, creado por el discovery.
4. Monitoring → APM → Traces: los servicios `hotel-web`, `reservas-api`, `habitaciones-api` y `pagos-api`.
5. Dashboards Hotel · Negocio, Hotel · Operación y Hotel · Cloud Cost con datos.

Comportamiento esperado de los actos (probado contra Zabbix 8.0):

- `act1 promo` cambia el modo de la webapp.
- `act3 gcp` abre `GCP: Daily cost yesterday high` en unos 6 s.
- `act2 corte` produce en unos 2 min un incidente Disaster "Incidente eléctrico: el hotel perdió el suministro de red", con 8 síntomas correlacionados por CEP.
- `act2 elevador` abre "Elevador 1 fuera de servicio" sin correlacionar.
- `act2 normal` y `act3 normal` cierran todo en segundos.

## Probar en local sin Dokploy

Copia `.env.example` a `.env`, completa los valores. La red `ZABBIX_NETWORK` debe existir.

```bash
cp .env.example .env
docker compose --env-file .env up -d --build
```

Si el Zabbix no está en Docker, agrega un override con `extra_hosts: ["host.docker.internal:host-gateway"]` y una red no externa, y apunta las variables (`ZABBIX_URL`, `ZABBIX_TRAPPER_HOST`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `CH_URL`) a `host.docker.internal`.

## Avisos

- La barra de la vista pixel dispara actos sin contraseña. Si publicas el puerto a internet, usa `PIXEL_CONTROLES=0`.
- El panel `/demo` de la webapp también cambia el modo sin autenticación. No lo expongas a internet sin restringirlo.
- `CONTROL_TOKEN` es obligatorio. Sin él el control solo responde `/salud`.
- Usa un `OTEL_SERVICE_NAMESPACE` distinto por despliegue, para que dev y prod no mezclen KPI.
- Reiniciar el contenedor reinicia todos los procesos de la demo. El estado persiste en el volumen `estado`.

## Solución de problemas

- El provisioning falla: el log muestra `[provision] !! ... la demo arranca igual`. Revisa que `ZABBIX_API_TOKEN` sea de un Super admin y válido, que `ZABBIX_NETWORK` coincida con la red del stack y que `zabbix-web` resuelva dentro de ella. Puedes repetirlo a mano (ver `provision/README.md`).
- No hay trazas: confirma que el proxy tenga "Data collection enabled" en su pestaña APM y que `OTEL_EXPORTER_OTLP_ENDPOINT` resuelva dentro de la red (`zabbix-proxy-apm:4317`).
- `apm-hotel-production` no aparece: espera al discovery de 5 min, o fuerza Execute now sobre el discovery del host `apm-discovery-test`.
- `demo.sh` no conecta: revisa `CONTROL_URL`, que `CONTROL_PORT` esté publicado y que `CONTROL_TOKEN` coincida. `GET /salud` no pide token y sirve para probar el alcance.
