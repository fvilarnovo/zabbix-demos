# Estadio Zabbix: noche de partido de Zabbix FC

Un estadio de fútbol en pixel art y en corte lateral, en plena noche de partido: la tribuna, la cancha con su cartelería LED, los accesos, la boletería, la tienda oficial del club y, en el subsuelo, la sala eléctrica y el centro de control. Tres fallas distintas pueden ocurrir a la vez y CEP de Zabbix 8.0 separa cada una en su propio incidente, con su causa y sus síntomas, aunque crucen energía, pantallas, operación, negocio y servicios instrumentados con APM.

Todo es simulado y ficticio: Zabbix FC, Deportivo Downtime y el estadio no existen, y no hay sensores ni equipos reales. Las compras de entradas, los pases por el molinete y las ventas de la tienda sí generan trazas OpenTelemetry reales.

Un solo contenedor corre la escena, cuatro servicios instrumentados, el generador de carga, el simulador, el control y el provisioning. Para desplegarla, sigue `docs/DESPLIEGUE-DOKPLOY.md`.

## La escena

| Franja | Qué muestra |
|---|---|
| Cielo | Torres de reflectores, pantalla gigante con el marcador, estado de los sistemas y del negocio |
| Estadio | Tribuna con el público (festeja los goles y prende los celulares si se corta la luz), cartelería LED perimetral con la publicidad y la cancha con el partido |
| Anillo de servicios | Acceso norte con la fila y los molinetes, boletería, tienda oficial de Zabbix FC con sus terminales de cobro, y las TVs del estadio |
| Subsuelo técnico | Sala eléctrica (acometida, tableros de iluminación, pantallas, comercial y servicios, UPS y generador) y centro de control con la pantalla de problemas de Zabbix, que muestra la causa y los síntomas que marcó CEP |

Clic en la boletería, los molinetes o la tienda: una operación real por los servicios, con su resultado en un cartel. Clic en la tribuna, la cancha, la cartelería, la pantalla gigante, los reflectores, la acometida, los tableros, la UPS, el generador o la pantalla de Zabbix: un cartel con sus datos.

## Escenarios

| Tecla | Acción | Qué se ve en Zabbix |
|---|---|---|
| 1 | Corte de la red eléctrica | CEP: la red es la causa; UPS, reflectores, cartelería LED, pantalla gigante, TVs y publicidad son sus síntomas |
| 2 | Base de datos de entradas sin respuesta | CEP: la base es la causa; rechazos en los molinetes, ingreso detenido, fila larga y errores de APM en accesos y boletería son sus síntomas |
| 3 | Interruptor del tablero comercial disparado | CEP: el interruptor es la causa; terminales de cobro, ventas y errores de APM de la tienda son sus síntomas |
| 0 | Reset | Todo vuelve a la normalidad y se cierran las ventanas CEP |

Los tres escenarios se pueden combinar: cada uno queda en su propio incidente.

El apagón es una línea de tiempo fija, con la causa siempre primero:

| Segundo | Evento | Trigger |
|---|---|---|
| 0 | Cae el suministro de la red | Energía: sin suministro de la red externa |
| 10 | La UPS pasa a batería | UPS: en batería |
| 15 | Se apagan los reflectores: el partido se detiene | Iluminación: nivel bajo en la cancha |
| 25 | Se apagan la cartelería LED y la pantalla gigante | Cartelería LED: segmentos apagados · Pantalla gigante: apagada |
| 30 | La publicidad deja de facturar | Publicidad: sin emisión de anuncios |
| 35 | Las TVs quedan fuera de línea | TVs del estadio: fuera de línea |
| 50 | Arranca el generador: iluminación de emergencia al 50 % | La cancha sigue bajo el umbral; las pantallas no son carga esencial y siguen apagadas |
| 60 | La UPS vuelve a la línea y recarga | Se resuelve "UPS: en batería" |

Medido en el laboratorio, a velocidad 1:

| Escenario | Incidente | Causa visible en | Último síntoma en | Recuperación tras el reset |
|---|---|---|---|---|
| 1 Apagón | 1 causa y 5 síntomas abiertos (la UPS abre y se resuelve sola al arrancar el generador) | 4 s | 36 s | 10 s |
| 2 Base de entradas | 1 causa y 5 síntomas | 4 s | 68 s (APM boletería) | 75 s |
| 3 Tablero comercial | 1 causa y 3 síntomas | 4 s | 52 s (APM tienda) | 90 s |

Con los tres activos a la vez quedan tres incidentes separados, sin problemas sueltos, y todo se resuelve en unos 90 s. Los problemas de APM por Telemetry query son los últimos en abrir y en cerrar.

Cada regla CEP tiene su propio evento de reinicio (`est.cep.reinicio[alimentacion]`, `[flujo]` y `[circuito]`): un único evento con los tres tags solo cierra la ventana de la primera regla, y las fallas siguientes quedarían como síntomas de una causa ya resuelta.

## Variables

Las variables comentadas están en `.env.example`. Las obligatorias son `ZABBIX_NETWORK`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ZABBIX_URL`, `ZABBIX_API_TOKEN` y `CONTROL_TOKEN`.

| Variable | Por defecto | Para qué |
|---|---|---|
| `ZABBIX_NETWORK` | (obligatoria) | Red Docker del stack de Zabbix |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (obligatoria) | Colector APM del proxy de Zabbix, con `http://` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `http/protobuf` solo para un collector OTel |
| `OTEL_SERVICE_NAMESPACE` | `estadio` | Un namespace por despliegue: define el host `apm-<namespace>-<entorno>` |
| `OTEL_DEPLOYMENT_ENVIRONMENT` | `production` | Entorno de las trazas |
| `ZABBIX_TRAPPER_HOST`, `ZABBIX_TRAPPER_PORT` | `zabbix-server`, `10051` | Destino de los trappers del simulador |
| `ZABBIX_URL`, `ZABBIX_API_TOKEN` | (obligatorias) | API de Zabbix y token de un Super admin |
| `PROVISION` | `1` | `0` para no tocar Zabbix al arrancar |
| `CH_URL`, `CH_USER`, `CH_PASSWORD` | `http://clickhouse:8123/`, `zabbix`, vacío | ClickHouse tal como lo ve el Zabbix server |
| `TRAPPER_ALLOWED` | subredes privadas | Desde qué IPs aceptan datos los ítems trapper (macro global compartida) |
| `DASHBOARDS_PREFIJO` | `Estadio` | Dashboards que se listan en `/salida/resumen.json` |
| `CONTROL_TOKEN` | (obligatoria) | Token del servicio de control |
| `ESTADIO_CONTROLES` | `1` | `0` deja la escena solo para mirar |
| `APP_PORT`, `CONTROL_PORT` | `8099`, `8100` | Puertos del host |

El Zabbix server necesita `TelemetryProvider` configurado: sin eso, los ítems Telemetry query no devuelven datos.

## Puertos

| Interno | Host por defecto | Uso | Dominio |
|---|---|---|---|
| 8000 | `APP_PORT` (8099) | Escena pixel art | Sí |
| 8091 | `CONTROL_PORT` (8100) | Control con Bearer token | No |

La escena no pide contraseña y puede provocar fallas. Con `ESTADIO_CONTROLES=0` queda solo para mirar.

## Objetos en Zabbix

- Hosts con prefijo `Estadio - `: Energía, Tableros, Iluminación, Pantallas, Accesos, Boletería, Tienda, Negocio y APM discovery.
- `apm-<namespace>-<entorno>` lo crea el discovery cuando llegan trazas (nombre visible `APM <namespace> (<entorno>)`). Nada depende de ese host para arrancar.
- Servicios instrumentados: `accesos` (molinetes), `boleteria`, `tienda` y `cobros`.
- KPI desde las trazas en "Estadio KPIs by ClickHouse"; p95 y errores en "Estadio APM by Telemetry query".
- Tres reglas CEP con prefijo `Estadio:`, creadas por `provision/post_provision.py`. Agrupan por los tags `alimentacion` (red eléctrica), `flujo` (ingreso del público) y `circuito` (tablero comercial).
- Dashboards: "Tablero ejecutivo · Estadio" y "Estadio · Operación e infraestructura" (páginas Público y accesos, Energía e iluminación, Pantallas y tienda, Servicios y APM). Las vistas de APM asumen `OTEL_SERVICE_NAMESPACE=estadio`.

Los eventos llevan `demo=estadio` y tags propios, para no entrar en las reglas de otras demos.

## Preguntas por MCP

1. ¿Cuánta gente hay en el estadio y cuánto estamos facturando por hora?
2. ¿Por qué se detuvo el partido?
3. ¿Cuánta autonomía le queda a la UPS y cuánto combustible tiene el generador?
4. ¿Por qué hay fila en las puertas?
5. ¿La tienda sin cobro tiene que ver con el apagón?
6. ¿Cuántas entradas vendimos hoy y cuánto recaudó la tienda?

## Verificación

1. En los logs: `Provisioning completo` y `9 procesos en marcha`.
2. Copia `cliente/demo.env.example` a `cliente/demo.env`, complétalo y ejecuta `cliente/demo.sh check`.
3. Aparece `apm-<namespace>-<entorno>` y hay trazas en APM → Traces.
