# Despliegue de las demos en Dokploy

Procedimiento para desplegar cualquier demo de este repositorio en Dokploy, junto a un stack de Zabbix 8.0. Es un documento general. El README de cada demo (`demos/<demo>/README.md`) es el específico: variables, puertos y comportamiento propios.

Todo lo descrito aquí se verificó en un despliegue real.

## 1. Prerrequisitos del lado Zabbix

Las demos se despliegan junto a un stack Compose de Zabbix 8.0 en Dokploy. El stack se basa en el compose público de referencia de Zabbix 8.0 con PostgreSQL. Debe tener estos servicios:

| Servicio | Puerto | Publicación |
|---|---|---|
| `zabbix-server` | 10051 | No publicado |
| `zabbix-web` | 8080 | Por Traefik |
| `zabbix-proxy-apm` | 4317 (OTLP/gRPC) | Único puerto publicado |
| `clickhouse` | 8123 (con usuario y contraseña) | No publicado |
| `zabbix-mcp-server` | 8443 | Por Traefik |
| `postgres` | interno | No publicado |

### 1.1 Configuración manual (una sola vez)

1. **Proxy APM.** Registrar el proxy como activo. En su pestaña APM, activar "Data collection enabled". Sin eso el puerto 4317 no abre.
2. **Fuente de datos APM.** En Administration → Data source → APM, configurar:
   - URL: `http://clickhouse:8123`
   - Base de datos: `zabbix`
   - Usuario y contraseña de ClickHouse.

   Esto habilita el menú APM nativo (Traces, Metrics, Logs).
3. **Token de API.** Crear un token de API de un usuario Super admin. Lo usa el provisioning de la demo.

### 1.2 Cómo funciona el APM

- El proxy APM solo acepta OTLP/gRPC en el 4317. No acepta HTTP (4318).
- El proxy escribe directo en ClickHouse.
- El esquema `otel_*` lo crea el servicio de init del stack.

## 2. Encontrar el nombre de la red del stack de Zabbix

La demo debe unirse a la red Docker del stack de Zabbix. Esa red se llama `<appName>_default`, donde `<appName>` es el prefijo de los contenedores del proyecto.

En Dokploy: Docker → Networks. Busca la que termina en `_default` y tiene el prefijo de los contenedores del proyecto.

Por línea de comandos, en el servidor:

```bash
docker network ls | grep zabbix
```

O, desde un contenedor del stack:

```bash
docker inspect <contenedor> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
```

Cada entorno (dev, prod) tiene su propia red. Ese nombre va en la variable `ZABBIX_NETWORK` de la demo.

## 3. Crear el servicio de la demo

1. Projects → Create Project.
2. Dentro del proyecto: Create Service → Compose.
3. Elegir el proveedor según cómo se acceda a Dokploy.

| Situación | Proveedor |
|---|---|
| Dokploy tiene URL pública | GitHub, con GitHub App propia |
| Dokploy se usa por `localhost` o solo por red interna | Pestaña **Git** genérica |

### 3.1 GitHub con GitHub App propia

1. Settings → Git → GitHub: crea la app.
2. Instálala dando acceso al repositorio.
3. En el servicio, elige repositorio y rama.

Con este proveedor puede haber autodeploy al hacer push.

### 3.2 Git genérico

Si Dokploy se usa por `localhost` o solo por red interna, GitHub rechaza la app con:

```text
Hook url is not supported because it isn't reachable over the public Internet (localhost)
```

En ese caso usa la pestaña **Git**:

- URL https del repositorio. Sin credenciales si es público.
- Rama: `main`.
- Compose Path: `./demos/<demo>/docker-compose.yml`.
- Watch Paths (opcional): `demos/<demo>/**`.

Con Git genérico no hay autodeploy al hacer push: pulsa Deploy a mano.

## 4. Environment antes del primer Deploy

1. En la pestaña Environment del servicio, pega el `.env.example` de la demo completo.
2. Completa las variables obligatorias:
   - `ZABBIX_NETWORK`: la red del punto 2.
   - `ZABBIX_API_TOKEN`: el token del Super admin.
   - La contraseña de ClickHouse.
   - Los tokens propios de la demo, como `CONTROL_TOKEN`. Genera uno con:

     ```bash
     openssl rand -hex 24
     ```
3. Una variable por línea, sin espacios alrededor de `=`.

Si falta una variable marcada con `:?` en el compose, el deploy falla al instante. El mensaje nombra cuál falta:

```text
error while interpolating services.<x>.environment.<VAR>: required variable <VAR> is missing a value
```

## 5. Deploy

1. Pulsa Deploy.
2. Dokploy clona el repositorio y construye la imagen desde el Dockerfile. No hace falta registro de imágenes.
3. La primera vez tarda minutos.
4. En Logs, busca:
   - El provisioning, paso a paso.
   - `[supervisor] N procesos en marcha`.

Para actualizar: haz push al repositorio y pulsa Deploy. Si cambió el Dockerfile, pulsa Rebuild.

## 6. Dominios (URL pública)

En la pestaña Domains → Add Domain:

| Campo | Valor |
|---|---|
| Service name | El servicio del compose |
| Host | Dominio propio con DNS A hacia la IP del servidor, o un nombre `*.sslip.io` que Dokploy genera (resuelve solo) |
| Path | `/` |
| Container Port | Puerto **interno** del contenedor (p. ej. 8000), no el publicado en el host |
| HTTPS | Let's Encrypt (requiere los puertos 80 y 443 abiertos) |

Notas:

- Un dominio por puerto interno. Por ejemplo, uno para la webapp (8000) y otro para la vista pixel (8090).
- Después de agregar o cambiar dominios hay que **redesplegar**. Hasta entonces Traefik responde `404 page not found`.
- "Validate DNS" en amarillo solo indica que no se pulsó.
- El certificado tarda uno o dos minutos.
- Si aparece "Bad Gateway", el contenedor no está en la red que ve Traefik (`dokploy-network`). Hay que agregarla al compose.

## 7. Red y seguridad

- La demo se une a la red del stack de Zabbix para llegar a `zabbix-proxy-apm:4317`, `zabbix-server:10051` y `zabbix-web:8080`.
- Los ítems trapper deben permitir las subredes de Docker (`TRAPPER_ALLOWED`).
- No publiques con dominio los puertos de control.
- Cualquier panel sin autenticación (controles de la demo) debe desactivarse o no exponerse a internet.
- Usa un `OTEL_SERVICE_NAMESPACE` distinto por despliegue, para que dev y prod no mezclen datos en el mismo Zabbix.

## 8. Verificación

1. Logs del contenedor: provisioning terminado y procesos en marcha.
2. Data collection → Hosts: los hosts de la demo.
3. Unos 5 minutos después de que haya tráfico, el discovery APM crea el host `apm-<namespace>-<entorno>`.
4. Monitoring → APM → Traces: los servicios de la demo.
5. Los dashboards de la demo con datos.
6. El `check` de la demo, si lo tiene (ver su README).

## 9. Errores conocidos y su causa

| Síntoma | Causa | Qué hacer |
|---|---|---|
| El deploy falla con `required variable <VAR> is missing a value` | Environment incompleto | Completar la variable que nombra el mensaje y desplegar de nuevo |
| `404 page not found` en el dominio | Falta redesplegar tras agregar o cambiar el dominio | Pulsar Deploy |
| `Hook url is not supported ... (localhost)` al crear la GitHub App | Dokploy sin URL pública | Usar la pestaña Git genérica (punto 3.2) |
| Trapper con `processed: N; failed: M` | Hosts o ítems inexistentes en ese Zabbix, o IP de origen no permitida en `{$TRAPPER.ALLOWED_HOSTS}` | Revisar que el provisioning creó los hosts e ítems, y ajustar `TRAPPER_ALLOWED` |
| Sin trazas | Proxy sin APM habilitado; endpoint que no resuelve dentro de la red; o app enviando OTLP/HTTP a un proxy que solo acepta gRPC | Activar "Data collection enabled"; revisar el endpoint y la red; usar OTLP/gRPC |
| No aparece `apm-<ns>-<env>` | El discovery aún no corrió | Esperar unos 5 minutos, o Execute now en el host de discovery |
| Bad Gateway | El contenedor no está en la red que ve Traefik | Agregar `dokploy-network` al compose |
