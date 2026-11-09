# export/

Aquí van los YAML exportados de Zabbix que `provisionar.py` importa al arrancar el contenedor
(`templates_*.yaml`, `hosts_*.yaml`, `dashboards_*.yaml`; orden: templates, hosts, dashboards, resto).

Se generan con `comun/exportar_zabbix.py` desde la raíz del repositorio:

    ZABBIX_URL=https://IP/api_jsonrpc.php ZABBIX_API_TOKEN=xxxx python3 comun/exportar_zabbix.py \
        --demo PLANTILLA --templates "Template A,Template B" --hosts "Host X" --dashboards "Dashboard 1" \
        --salida demos/PLANTILLA/provision/export

TODO: exportar y guardar aquí los YAML de la demo.
