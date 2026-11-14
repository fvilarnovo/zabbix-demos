# export/

YAML de Zabbix que `provisionar.py` importa al arrancar el contenedor (orden: templates, hosts, dashboards).
Se generan desde un Zabbix donde la demo ya existe, con `comun/exportar_zabbix.py`.
Las reglas CEP no van aquí: las crea `provision/post_provision.py`.
