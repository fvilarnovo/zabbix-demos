# Tormenta solar: Central Zabbix y ZABBIXSAT-1

Una central nucleoeléctrica y un satélite de observación, en pixel art y en corte por pisos. Una tormenta geomagnética golpea a los dos a la vez y CEP de Zabbix 8.0 encuentra la causa común entre síntomas de dominios distintos: el satélite, la red eléctrica, la hora GPS, el reactor y un servicio instrumentado con APM.

La historia está inspirada en la tormenta de mayo de 2024: alarmas de corriente inducida en transformadores, una central nuclear que bajó potencia por procedimiento, y satélites con arrastre y errores. Todo es simulado y ficticio: no hay datos de ninguna planta ni satélite reales. Los pedidos de imágenes sí generan trazas OpenTelemetry reales.

Un solo contenedor corre la escena, tres servicios instrumentados, el generador de carga, el simulador, el control y el provisioning. Para desplegarla, sigue `docs/DESPLIEGUE-DOKPLOY.md`.

## La escena

| Franja | Qué muestra |
|---|---|
| Cielo | ZABBIXSAT-1 en órbita, auroras durante la tormenta, antena de la estación terrena siguiendo al satélite, línea de alta tensión |
| Piso superior | Turbina, generador (MW a la red) y transformador principal, con chispas por la corriente inducida |
| Piso intermedio | Sala de control con el panel de alarmas, diodo de datos (los datos solo salen de la red de control), centro de datos con la pantalla de problemas de Zabbix, que muestra la causa y los síntomas que marcó CEP |
| Piso inferior | Vasija del reactor con las barras de control entrando desde abajo y piscina de combustible gastado con brillo de Cherenkov |

Clic en el satélite: pide una imagen por toda la cadena de servicios y muestra el resultado en un cartel. Clic en el reactor, la turbina, el transformador, la piscina, el diodo, el panel de alarmas o la pantalla de Zabbix: un cartel con sus datos.

## Escenarios

| Tecla | Acción | Qué se ve en Zabbix |
|---|---|---|
| 1 | Tormenta geomagnética G4 | CEP: el índice Kp es la causa; ocho síntomas en el satélite, la planta, la estación terrena y el APM |
| 2 | Bomba B de la piscina disparada | Un incidente aparte: la bomba es la causa y la temperatura, su síntoma. No entra en la tormenta |
| 0 | Reset | Todo vuelve a la normalidad y se cierran las ventanas CEP |

La tormenta es una línea de tiempo fija, con la causa siempre primero:

| Segundo | Evento | Trigger |
|---|---|---|
| 0 | Kp sube a 8 | Clima espacial: tormenta geomagnética (Kp ≥ 7) |
| 10 | Errores por radiación en el satélite | ZABBIXSAT-1: errores por radiación altos |
| 25 | El sensor de estrellas pierde el enganche | ZABBIXSAT-1: sensor de estrellas sin enganche |
| 40 | Se desvía la hora GPS de la planta | Planta TI: desfase de la hora GPS |
| 55 | Corriente inducida en el transformador | Transformador principal: corriente inducida alta |
| 70 | Se insertan barras: la potencia baja al 70 % | Reactor: potencia reducida por procedimiento |
| 85 | Se calienta el aceite del transformador | Transformador principal: temperatura alta |
| 90 | Se degrada el enlace de bajada | Estación terrena: enlace de bajada degradado |
| ~140 | Los pedidos de imágenes fallan | APM planificador: tasa de errores alta (Telemetry query) |

Medido en el laboratorio: la tormenta abre 1 causa y 8 síntomas en un solo incidente; la bomba, con la tormenta activa, abre un incidente aparte. Tras el reset, casi todo se resuelve en 20 s y el problema de APM en unos 80 s.

## Variables

Las variables comentadas están en `.env.example`. Las obligatorias son `ZABBIX_NETWORK`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ZABBIX_URL`, `ZABBIX_API_TOKEN` y `CONTROL_TOKEN`.

El Zabbix server necesita `TelemetryProvider` configurado: sin eso, los ítems Telemetry query no devuelven datos.

## Puertos

| Interno | Host por defecto | Uso | Dominio |
|---|---|---|---|
| 8000 | `APP_PORT` (8097) | Escena pixel art | Sí |
| 8091 | `CONTROL_PORT` (8098) | Control con Bearer token | No |

La escena no pide contraseña y puede provocar fallas. Con `TORMENTA_CONTROLES=0` queda solo para mirar.

## Objetos en Zabbix

- Hosts con prefijo `Tormenta - `: Clima espacial, ZABBIXSAT-1, Estación terrena, Planta reactor, Planta eléctrica, Planta piscina, Planta TI, Negocio y APM discovery.
- `apm-<namespace>-<entorno>` lo crea el discovery cuando llegan trazas (nombre visible `APM <namespace> (<entorno>)`). Nada depende de ese host para arrancar.
- KPI desde las trazas en "Tormenta KPIs by ClickHouse"; p95 y errores en "Tormenta APM by Telemetry query".
- Dos reglas CEP con prefijo `Tormenta:`, creadas por `provision/post_provision.py`. Agrupan por los tags `exposicion` (clima espacial) y `circuito` (piscina).
- Dashboards: "Tablero ejecutivo · Tormenta" y "Tormenta · Planta y satélite" (páginas Planta, Satélite y clima espacial, Servicios y APM). Las vistas de APM asumen `OTEL_SERVICE_NAMESPACE=tormenta`.

Los eventos llevan `demo=tormenta` y tags propios, para no entrar en las reglas de otras demos.

## Preguntas por MCP

1. ¿Cuánta energía estamos entregando y cuánto facturamos por hora?
2. ¿Por qué bajó la potencia del reactor?
3. ¿Qué tienen en común el satélite y la planta?
4. ¿La bomba de la piscina tiene que ver con la tormenta?
5. ¿Cuánto margen de temperatura le queda a la piscina?

## Verificación

1. En los logs: `Provisioning completo` y `8 procesos en marcha`.
2. Copia `cliente/demo.env.example` a `cliente/demo.env`, complétalo y ejecuta `cliente/demo.sh check`.
3. Aparece `apm-<namespace>-<entorno>` y hay trazas en APM → Traces.
