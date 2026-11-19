# export/

YAML de Zabbix que `provisionar.py` importa al arrancar el contenedor (orden: templates, hosts, dashboards).

- `templates_apm_clickhouse.yaml`: templates APM de proveedor (los mismos que usan aeropuerto y tormenta).
- `templates_autopista.yaml`, `hosts_autopista.yaml`, `dashboards_autopista.yaml`: generados con
  `python3 herramientas/generar_export.py` desde `web/static/corredor.json`, así las claves coinciden con el simulador.

Las reglas CEP no van aquí: las crea `provision/post_provision.py`.
