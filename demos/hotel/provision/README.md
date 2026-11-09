# Provisioning de la demo del hotel

Script idempotente que deja un Zabbix 8.0 listo para la demo (puede correr en cada arranque):
espera la API, crea/actualiza la macro global `{$TRAPPER.ALLOWED_HOSTS}`, importa templates, hosts y dashboards,
fija las macros de ClickHouse, corrige ítems trapper, crea las reglas CEP, opcionalmente el usuario MCP de solo
lectura, fuerza el discovery APM y escribe `/salida/resumen.json`. Termina con código 0 solo si todo fue bien.

## Cómo corre

- En el contenedor `hotel-demo`: `supervisor.py` lo ejecuta al arrancar si `PROVISION=1`. Si falla, lo registra
  (`[provision] !! ...`) y la demo arranca igual. Las variables son las del `.env.example`.
- A mano: desde cualquier máquina con Python 3 y acceso a la API de Zabbix.

## Variables

| Variable | Default | Descripción |
|---|---|---|
| `ZABBIX_URL` | (obligatoria) | p. ej. `http://zabbix-web:8080/api_jsonrpc.php` |
| `ZABBIX_API_TOKEN` | (obligatoria) | token de Super admin |
| `CH_URL` | `http://clickhouse:8123/` | ClickHouse HTTP |
| `CH_USER` | `zabbix` | usuario de ClickHouse |
| `CH_PASSWORD` | vacío | contraseña de ClickHouse |
| `TRAPPER_ALLOWED` | `10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | valor de `{$TRAPPER.ALLOWED_HOSTS}` |
| `OTEL_SERVICE_NAMESPACE` | `hotel` | namespace OTel (`{$APM.NAMESPACE.MATCHES}`) |
| `PROVISION_MCP_USER` | `0` | `1` crea el usuario `demo-hotel` y su token |
| `MCP_TOKEN_FILE` | `/salida/zabbix_mcp_demo_token` | dónde se guarda el token MCP (nunca se imprime) |
| `ESPERA_API_SEG` | `300` | segundos máximos esperando la API |

## Directo con Python

Solo biblioteca estándar. Desde una máquina con Python 3 y acceso a la API:

```sh
ZABBIX_URL=https://127.0.0.1/api_jsonrpc.php ZABBIX_API_TOKEN=... python3 provisionar.py
```

Nota: sin `/salida` escribible, `resumen.json` se crea en esa ruta; ajústala o crea la carpeta con permisos.
`importar_zabbix.py` sigue funcionando por separado (solo importa), igual que `crear_cep_hotel.py` y `crear_usuario_mcp.py`.
