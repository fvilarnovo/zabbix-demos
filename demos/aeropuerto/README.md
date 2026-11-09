# Aeropuerto Forum

Terminal aérea en 3D para demostrar OT, CEP y APM de Zabbix 8.0. El presentador provoca fallas tocando objetos de la escena y ve cómo reacciona Zabbix. Toda la operación es simulada y llega a Zabbix por trapper; las trazas del check-in son OpenTelemetry reales.

Un solo contenedor corre la webapp 3D, cuatro servicios instrumentados, el generador de carga, el simulador, el control y el provisioning. Para desplegarla, sigue `docs/DESPLIEGUE-DOKPLOY.md`.

## Variables

Las variables comentadas están en `.env.example`. Las obligatorias son `ZABBIX_NETWORK`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `ZABBIX_URL`, `ZABBIX_API_TOKEN` y `CONTROL_TOKEN`.

El Zabbix server necesita `TelemetryProvider` configurado: sin eso, los ítems Telemetry query no devuelven datos.

## Puertos

| Interno | Host por defecto | Uso | Dominio |
|---|---|---|---|
| 8000 | `APP_PORT` (8095) | Escena 3D | Sí |
| 8091 | `CONTROL_PORT` (8096) | Control con Bearer token | No |

La escena no pide contraseña y puede provocar fallas. Con `AEROPUERTO_CONTROLES=0` queda solo para mirar.

## Escenarios

| Tecla | Acción | Qué se ve en Zabbix |
|---|---|---|
| Clic en pasajero | Check-in real | Traza `kiosco`, `reservas`, `pasajes`, `equipaje` en el menú APM |
| 1 | Cinta en sobrecorriente | OT y CEP: la cinta es la causa; acumulación, colas y demoras son síntomas |
| 2 / 3 | Pasajes con errores / lento | APM: errores o latencia en `pasajes`; la cola crece sin falla OT |
| 4 | Scanner fuera de servicio | OT: el scanner cae y crece la cola de seguridad |
| 5 / 6 | Manga / UPS | OT: problema del equipo |
| 7 | Hora pico | Más carga, sin problemas |
| 8 | Demoras repetidas | CEP: tres demoras pasan a ser un solo problema |
| 9 | Vuelo sin salida | CEP: evento esperado ausente |
| 0 | Reset | Todo vuelve a la normalidad y se cierra la ventana CEP |

## Objetos en Zabbix

- Hosts fijos con prefijo `Aeropuerto - `: Terminal, Cinta 1, Scanner 1 a 3, Manga 1 a 3, UPS T1, Negocio y APM discovery.
- `apm-<namespace>-<entorno>` lo crea el discovery cuando llegan trazas. Nada depende de ese host para arrancar.
- KPIs desde las trazas en "Aeropuerto KPIs by ClickHouse"; p95 y errores en "Aeropuerto APM by Telemetry query".
- Tres reglas CEP con prefijo `Aeropuerto:`, creadas por `provision/post_provision.py`.
- Dashboards: "Tablero ejecutivo · Aeropuerto" y "Aeropuerto · Terminal" (páginas Operación, Equipos e infraestructura, Servicios y APM). Las vistas por servicio asumen `OTEL_SERVICE_NAMESPACE=aeropuerto` y se llenan cuando aparece el host APM.

Los eventos llevan `demo=aeropuerto` y tags propios, para no entrar en las reglas de otras demos.

## Verificación

1. En los logs: `Provisioning completo` y `9 procesos en marcha`.
2. Copia `cliente/demo.env.example` a `cliente/demo.env`, complétalo y ejecuta `cliente/demo.sh check`.
3. Aparece `apm-<namespace>-<entorno>` y hay trazas en APM → Traces.
