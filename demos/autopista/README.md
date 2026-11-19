# Autopista

Gemelo digital 3D de un corredor vial de 153 km con 4 unidades funcionales, tres peajes (Vegachí, Santa Isabel y Puerto Berrío), equipos ITS y un centro de control. Está inspirado en un corredor real del Magdalena Medio colombiano. La demo muestra en un mismo Zabbix 8.0:

- **OT del corredor**: flujo vehicular por tramo, colas, plazas de peaje (carriles, barreras, energía, UPS, enlace) y equipos ITS (nodos de fibra, cámaras DAI, radares, PMV, estaciones meteorológicas, gálibo).
- **APM de la app de control de peajes**: cinco servicios instrumentados con OpenTelemetry. Cada vehículo que paga hace una transacción **real** contra la app. Sus trazas llegan al APM nativo de Zabbix, y su latencia o su error deciden cuánto tarda en abrirse la barrera.
- **Causa raíz con CEP**: las reglas de Zabbix 8.0 agrupan causa y síntomas por zona. Además detectan incidentes por patrón y marcan la causa raíz central en los síntomas que aparecen en las plazas.

## Vistas

| Ruta | Qué muestra |
|---|---|
| `/` | Escena 3D del corredor: tránsito, peajes, ITS, unidades de servicio y la sala de control del CCO (tecla `O`), cuyas pantallas muestran Zabbix. La tecla `X` sigue a un vehículo |
| `/peaje` | App de control de peajes: carriles en vivo, transacciones reales con su traza, mapa de servicios con los datos de APM de Zabbix, botones para simular problemas y lo que Zabbix detecta con el CEP |
| `/cco` | Centro de mando tipo video wall: corredor 3D en recorrido automático, paneles de Zabbix (severidades, causa y síntomas, historial), app de peajes, KPI, fallas y bitácora |

Los paneles de Zabbix del centro de mando y de la sala 3D se dibujan con la API (`problem.get`, `item.get` e `history.get`), porque el frontend de Zabbix no se deja incrustar en otro dominio (`X-Frame-Options: SAMEORIGIN`). Un enlace abre el dashboard real.

Un solo contenedor corre la escena 3D, los cinco servicios de recaudo, el simulador, el control y el provisioning. Para desplegarla, sigue `docs/DESPLIEGUE-DOKPLOY.md`.

## Variables

Las variables comentadas están en `.env.example`. Las obligatorias son:
- `ZABBIX_NETWORK`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `ZABBIX_URL`
- `ZABBIX_API_TOKEN` (de un Super admin)
- `CONTROL_TOKEN`

`CH_PASSWORD` hace falta para los KPI de recaudo calculados desde las trazas. `ZABBIX_WEB_URL` (la URL pública del frontend) es opcional: agrega a la escena el enlace al dashboard.

El Zabbix server necesita `TelemetryProvider` configurado. Sin eso, los ítems Telemetry query no devuelven datos.

## Puertos

| Interno | Host por defecto | Uso | Dominio |
|---|---|---|---|
| 8000 | `APP_PORT` (8097) | Escena 3D | Sí |
| 8091 | `CONTROL_PORT` (8098) | Control con Bearer token | No |

La escena no pide contraseña y puede provocar fallas. Con `AUTOPISTA_CONTROLES=0` queda solo para mirar.

## Escenarios

Las fallas se activan desde la barra inferior, con la tecla indicada o con `cliente/demo.sh`, y quedan activas hasta apagarlas o hacer Reset. La causa llega siempre primero a Zabbix y los síntomas después: la regla CEP toma el primer evento de la ventana como causa.

| Tecla | Escenario | Causa | Síntomas que agrupa el CEP |
|---|---|---|---|
| 1 | Corte de fibra UF-2 | Nodo de fibra UF-2: enlace troncal caído | Cámaras, radar y PMV de la UF-2 sin datos; Peaje Vegachí sin enlace con el CCO y en contingencia. Incidente por patrón |
| 2 | Peaje Vegachí sin energía | Sin red comercial | La planta de emergencia no arranca, la UPS baja, quedan carriles cerrados y se forma cola en la plaza y en la vía. Incidente por patrón |
| 3 | BD de recaudo con bloqueos | BD: sesiones bloqueadas | Pool saturado, latencia p95 y errores de `transacciones` y `peaje-gateway` (APM); colas en las plazas, marcadas con `causa_raiz=plataforma_recaudo` |
| 4 | Operador TAG caído | Interoperabilidad: el operador no responde | Errores y timeouts de `validacion-tag` y `operador-tag` (APM); TAG rechazados que se cobran en efectivo en las tres plazas |
| 5 | Fuga de memoria del gateway | Gateway: heap alto | Latencia p95 del gateway y reinicios con errores 503 (cada ~150 s) |
| 6 | Accidente km 100 | Cámara DAI km 99: vehículo detenido | Cola y velocidad baja en los tramos de la UF-3. El PMV km 92 avisa y salen la grúa, la ambulancia y la inspección. Incidente de severidad Desastre |
| 7 | Lluvia en Alto de Dolores | Meteo: precipitación intensa | Visibilidad reducida y velocidad baja en la UF-3; el PMV km 64 avisa |
| 8 | Barrera atascada en Puerto Berrío | Barrera en falla en el carril A3 | Carril cerrado y cola en la plaza (más visible en hora pico o con el escenario festivo) |
| 9 | Gálibo | Vehículo de 4,92 m antes del puente | Evento de cierre manual; sale la inspección vial |
| Q | Puente festivo | — | Más tránsito, sin problemas: muestra que los umbrales no son ruidosos |
| 0 | Reset | — | Todo vuelve a la normalidad y se cierran las ventanas CEP de todas las zonas |

Las teclas V, S, P, A, D, F, O y C llevan la cámara a cada lugar: Vegachí, Santa Isabel, Puerto Berrío, el accidente, Alto de Dolores, el nodo de fibra, el CCO y el corredor completo.

## Objetos en Zabbix

- **Hosts fijos con prefijo `Autopista - `:**
  - Corredor;
  - las tres plazas de peaje;
  - Plataforma de recaudo;
  - Recaudo (APM y KPI);
  - APM discovery;
  - 17 equipos ITS (`Autopista - ITS <id>`).

  Están en los grupos `Autopista/Corredor`, `Autopista/Peajes`, `Autopista/ITS`, `Autopista/Recaudo` y `Autopista/APM`.
- **Host `apm-<namespace>-<entorno>`:** lo crea el discovery cuando llegan las trazas. Nada depende de él para arrancar.
- **KPI de negocio desde las trazas** ("Autopista KPIs by ClickHouse"): recaudo del día total y por plaza, % de pagos con TAG, transacciones fallidas y TAG rechazados.
- **p95 y errores por servicio** en "Autopista APM by Telemetry query".
- **Seis reglas CEP con prefijo `Autopista:`**, creadas por `provision/post_provision.py`:
  - responsable por nivel;
  - causa y síntomas por zona;
  - cuatro incidentes por patrón.
- **Dashboard "Autopista · Operación del corredor"**, con cuatro páginas: Corredor y tránsito, Peajes, Recaudo y APM, y CEP: causa raíz.

Los eventos llevan `demo=autopista` y tags propios (`zona`, `rol`, `nivel`, `problema`, `recaudo`), para no entrar en las reglas de otras demos.

## Modelo y supuestos

Se basan en información pública del corredor real:
- las longitudes de las UF;
- las plazas de peaje y sus tarifas por categoría (en las transacciones y en el recaudo);
- el tipo de equipos ITS (cámaras con detección de incidentes, radares, gálibos, estaciones meteorológicas y PMV);
- los servicios viales (grúa, asistencia médica, inspección).

Son aproximados para la demo:
- el trazado;
- la abscisa de las plazas, del CCO y de cada equipo;
- tres carriles por sentido por plaza;
- la demanda horaria.

Todo eso está en `web/static/corredor.json`. Si lo cambias, regenera el export con `python3 herramientas/generar_export.py`: las claves de los ítems salen del mismo archivo que usa el simulador.

## Verificación

1. En los logs: `Provisioning completo` y `9 procesos en marcha`.
2. Copia `cliente/demo.env.example` a `cliente/demo.env`, complétalo y ejecuta `cliente/demo.sh check`.
3. Aparece `apm-<namespace>-<entorno>` y en APM → Traces hay trazas de `peaje-gateway`, `validacion-tag`, `operador-tag`, `tarifas` y `transacciones`.
4. Activa un escenario y revisa la página "CEP: causa raíz" del dashboard. Después haz Reset.
