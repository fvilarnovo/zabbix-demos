#!/usr/bin/env python3
"""Simulador FinOps multinube de la demo del hotel. Los datos son ficticios.

Uso:
  python3 finops_simulator.py --historia 7      # rellena los últimos días y termina
  python3 finops_simulator.py --historia-si-falta 7 --vivo --intervalo 10   # arranque del contenedor

Lo que cambia respecto a /root/finops_simulator.py:
- El mes es la suma de sus días: el acumulado del mes en curso es proporcional a los días transcurridos
  y coincide con el costo diario. Antes salía de una curva anual sin relación con él.
- Nunca envía valores con hora futura: last() de Zabbix devuelve el de hora más reciente, así que un
  valor del futuro tapa a todos los reales hasta que llegue esa hora.
- Las anomalías se activan con anomalia.py y duran hasta que se quitan. Antes eran un punto suelto que
  el siguiente envío borraba.
- El sobrecosto va solo al servicio y a la región afectados, de modo que el reparto sigue sumando el total.
"""
import argparse
import calendar
import datetime
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from hotel_finops import metricas_hotel
from zbx_sender import ZabbixSender  # noqa: E402

DIR_ANOMALIAS = os.environ.get("DIR_ANOMALIAS", os.path.join(os.environ.get("ESTADO_DIR", "/estado"), "finops"))
MARCA_HISTORIA = "historia_cargada"
RUIDO_VIVO = 0.01

NUBES = {
    "aws": {
        "host": "AWS Cost", "base": 74.0, "espiga": 90.0, "promedio": (72.5, 1.5),
        "servicio_anomalia": "Amazon EC2", "region_anomalia": "us-east-1",
        "servicios": {"Amazon EC2": 0.40, "Amazon RDS": 0.22, "Amazon S3": 0.15, "Amazon EKS": 0.10,
                      "AWS Lambda": 0.06, "Amazon DynamoDB": 0.04, "Amazon CloudFront": 0.03},
        "regiones": {"us-east-1": 0.50, "us-west-2": 0.25, "eu-west-1": 0.15, "sa-east-1": 0.10},
        "total": "aws.daily.service.total.cost", "media": "aws.daily.average.cost",
        "conteo": "aws.daily.service.count", "anual": "aws.cost.total",
        "servicio": 'aws.daily.service.cost["{}"]', "region": 'aws.region.daily.cost["{}"]',
        "mes": 'aws.monthly.cost["{}"]',
    },
    "azure": {
        "host": "Azure Cost", "base": 52.0, "espiga": 95.0, "promedio": (51.0, 1.2),
        "servicio_anomalia": "Virtual Machines", "region_anomalia": "eastus",
        "servicios": {"Virtual Machines": 0.38, "Azure SQL Database": 0.24, "Storage": 0.16,
                      "Azure Kubernetes Service": 0.12, "App Service": 0.06, "Virtual Network": 0.04},
        "regiones": {"eastus": 0.45, "westeurope": 0.30, "brazilsouth": 0.15, "centralus": 0.10},
        "total": "azure.daily.total.cost", "media": "azure.daily.average.cost",
        "conteo": "azure.daily.service.count", "anual": "azure.annual.cost",
        "servicio": 'azure.daily.service.cost["{}"]', "region": 'azure.daily.region.cost["{}"]',
        "mes": 'azure.monthly.cost["{}"]',
    },
    "oci": {
        "host": "Oracle Cloud Cost", "base": 31.0, "espiga": 92.0, "promedio": (30.0, 0.8),
        "servicio_anomalia": "Compute", "region_anomalia": "us-ashburn-1",
        "servicios": {"Compute": 0.45, "Autonomous Database": 0.30, "Object Storage": 0.12,
                      "Load Balancer": 0.08, "Virtual Cloud Network": 0.05},
        "regiones": {"us-ashburn-1": 0.50, "sa-saopaulo-1": 0.30, "eu-frankfurt-1": 0.20},
        "total": "oci_cost.usage.total.cost.daily.current", "media": "oci_cost.daily.average.cost",
        "conteo": "oci_cost.service.count", "anual": None,
        "servicio": 'oci_cost.usage.service.cost.daily.current["{}"]',
        "region": 'oci_cost.usage.region.cost.daily.current["{}"]',
        "mes": 'oci_cost.month.total.cost["{}"]',
    },
    "gcp": {
        # Espiga de 100 y no de 88: en fin de semana, con 88, no se alcanzaba el umbral de 120 del trigger
        "host": "Google Cloud Cost", "base": 42.0, "espiga": 100.0, "promedio": (40.5, 1.0),
        "servicio_anomalia": "BigQuery", "region_anomalia": "us-central1",
        "servicios": {"BigQuery": 0.35, "Compute Engine": 0.30, "Kubernetes Engine": 0.18,
                      "Cloud Storage": 0.10, "Cloud SQL": 0.07},
        "regiones": {"us-central1": 0.50, "europe-west1": 0.30, "southamerica-east1": 0.20},
        "total": "gcp.cost.daily.summary.yesterday", "media": "gcp.cost.daily.avg",
        "conteo": "gcp.cost.service.count", "anual": "gcp.annual.cost",
        "servicio": 'gcp.cost.daily.service["{}"]', "region": 'gcp.cost.daily.region["{}"]',
        "mes": 'gcp.cost.monthly["{}"]',
    },
}

AWS_CUENTAS = {"111122223333": 0.65, "444455556666": 0.25, "777788889999": 0.10}
AZURE_SUSCRIPCIONES = {"sub-prod-enterprise": 0.60, "sub-dev-sandbox": 0.25, "sub-core-infra": 0.15}
OCI_COMPARTIMENTOS = {"Production": 0.55, "Analytics": 0.30, "Database": 0.15}
GCP_PROYECTOS = {"prj-data-warehouse": 0.45, "prj-prod-frontend": 0.35, "prj-ml-platform": 0.20}


def factor_dia(fecha):
    """Factor determinista del día: el mismo día vale siempre lo mismo, sin importar cuándo se calcule."""
    base = 0.82 if fecha.weekday() >= 5 else 1.05
    ola = 1.0 + 0.08 * math.sin(fecha.timetuple().tm_yday / 30.0)
    return base * ola * random.Random(fecha.isoformat()).uniform(0.96, 1.04)


def costo_dia(nube, fecha):
    return NUBES[nube]["base"] * factor_dia(fecha)


def costo_hasta(nube, anio, mes, ultimo_dia):
    return sum(costo_dia(nube, datetime.date(anio, mes, d)) for d in range(1, ultimo_dia + 1))


def anomalias_activas():
    """Las anomalías son archivos en /run: se pierden al reiniciar, y entonces todo arranca normal."""
    return {n for n in NUBES if os.path.exists(os.path.join(DIR_ANOMALIAS, f"anomalia_{n}"))}


def ruido(amplitud=RUIDO_VIVO):
    return random.uniform(1 - amplitud, 1 + amplitud)


def metricas_dia(nube, normal, espiga, clock):
    """Métricas diarias de una nube. El costo normal se reparte; la espiga va a un solo servicio y región."""
    n = NUBES[nube]
    host = n["host"]

    def m(key, value):
        return {"host": host, "key": key, "value": value, "clock": clock}

    centro, margen = n["promedio"]
    salida = [
        m(n["total"], round(normal + espiga, 2)),
        m(n["media"], round(centro + random.uniform(-margen, margen), 2)),
        m(n["conteo"], len(n["servicios"])),
    ]
    anual = normal * 365 + espiga
    if n["anual"]:
        salida.append(m(n["anual"], round(anual, 2)))
    for nombre, parte in n["servicios"].items():
        extra = espiga if nombre == n["servicio_anomalia"] else 0
        salida.append(m(n["servicio"].format(nombre), round(normal * parte * ruido() + extra, 2)))
    for nombre, parte in n["regiones"].items():
        extra = espiga if nombre == n["region_anomalia"] else 0
        salida.append(m(n["region"].format(nombre), round(normal * parte * ruido() + extra, 2)))

    # Desgloses propios de cada proveedor
    if nube == "aws":
        for cuenta, parte in AWS_CUENTAS.items():
            salida.append(m(f'aws.account.yearly.total.cost["{cuenta}"]', round(anual * parte * ruido(), 2)))
    elif nube == "azure":
        for sub, parte in AZURE_SUSCRIPCIONES.items():
            salida.append(m(f'azure.yearly.subscription.yearly.cost["{sub}"]', round(anual * parte * ruido(), 2)))
    elif nube == "oci":
        salida.append(m("oci_cost.budget.actual.total", round(normal * 30 * 1.08, 2)))
        for comp, parte in OCI_COMPARTIMENTOS.items():
            actual = normal * 30 * parte
            salida.append(m(f'oci_cost.usage.compartment.cost.monthly.current["{comp}"]', round(actual, 2)))
            salida.append(m(f'oci_cost.usage.compartment.cost.monthly.previous["{comp}"]',
                            round(actual * random.Random(comp).uniform(0.92, 0.98), 2)))
    elif nube == "gcp":
        # El mes va fijo en la clave porque los ítems de proyecto solo existen con 2026-10
        for prj, parte in GCP_PROYECTOS.items():
            salida.append(m(f'gcp.cost.project.monthly["{prj}","2026-10"]', round(normal * 30 * parte * ruido(), 2)))
    return salida


def metricas_mes(nube, ahora, espiga, clock):
    """Meses cerrados y mes en curso. Va con la hora actual, igual que las plantillas de facturación."""
    n = NUBES[nube]
    salida = []
    for mes in range(1, ahora.month + 1):
        ultimo = ahora.day if mes == ahora.month else calendar.monthrange(ahora.year, mes)[1]
        total = costo_hasta(nube, ahora.year, mes, ultimo)
        if mes == ahora.month:
            total += espiga
        salida.append({"host": n["host"], "key": n["mes"].format(f"{ahora.year}-{mes:02d}"),
                       "value": round(total, 2), "clock": clock})
    return salida


def metricas_presupuesto(nube, ahora, espiga, clock):
    """Claves sin mes: la proyección de AWS y GCP las lee, y no hay que tocarla al cambiar de mes."""
    if nube not in ("aws", "gcp"):
        return []
    n = NUBES[nube]
    restantes = calendar.monthrange(ahora.year, ahora.month)[1] - ahora.day
    acumulado = costo_hasta(nube, ahora.year, ahora.month, ahora.day) + espiga
    return [{"host": n["host"], "key": "finops.month.acumulado", "value": round(acumulado, 2), "clock": clock},
            {"host": n["host"], "key": "finops.month.dias_restantes", "value": restantes, "clock": clock}]


def metricas_vivo(ahora, activas):
    clock = int(ahora.timestamp())
    salida, costos = [], {}
    for nube, n in NUBES.items():
        normal = costo_dia(nube, ahora.date()) * ruido()
        espiga = n["espiga"] if nube in activas else 0.0
        costos[nube] = (normal, espiga)
        salida += metricas_dia(nube, normal, espiga, clock)
        salida += metricas_mes(nube, ahora, espiga, clock)
        salida += metricas_presupuesto(nube, ahora, espiga, clock)
    return salida + metricas_hotel(costos, clock)


def metricas_historia(dias, ahora):
    """Un punto al mediodía de cada día anterior. Hoy queda fuera: el mediodía de hoy podría ser futuro."""
    salida = []
    for atras in range(dias, 0, -1):
        dia = (ahora - datetime.timedelta(days=atras)).replace(hour=12, minute=0, second=0, microsecond=0)
        clock = int(dia.timestamp())
        costos = {}
        for nube in NUBES:
            normal = costo_dia(nube, dia.date())
            costos[nube] = (normal, 0.0)
            salida += metricas_dia(nube, normal, 0.0, clock)
        salida += metricas_hotel(costos, clock)
    return salida


def enviar(sender, metricas):
    fallos = []
    for i in range(0, len(metricas), 250):
        ok, info = sender.send_batch(metricas[i:i + 250])
        if not ok or " failed: 0;" not in info:
            fallos.append(info)
    return fallos


def correr(sender, intervalo):
    print(f"Simulador en vivo: envía cada {intervalo} s", flush=True)
    vueltas = 0
    activas_antes = None
    while True:
        activas = anomalias_activas()
        if activas != activas_antes:
            print(f"Anomalías activas: {sorted(activas) or 'ninguna'}", flush=True)
            activas_antes = activas
        fallos = enviar(sender, metricas_vivo(datetime.datetime.now(), activas))
        if fallos:
            print(f"!! envío con fallos: {fallos}", flush=True)
        elif vueltas % 60 == 0:
            print("Envío correcto", flush=True)
        vueltas += 1
        # Revisa cada segundo si cambió una anomalía, para no esperar el intervalo completo
        for _ in range(intervalo):
            time.sleep(1)
            if anomalias_activas() != activas:
                break


def main():
    parser = argparse.ArgumentParser(description="Simulador FinOps de la demo del hotel")
    parser.add_argument("--server", default=os.environ.get("ZABBIX_TRAPPER_HOST", "zabbix-server"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("ZABBIX_TRAPPER_PORT", "10051")))
    parser.add_argument("--historia", type=int, default=0, help="días anteriores que se rellenan")
    parser.add_argument("--historia-si-falta", type=int, default=0, metavar="N",
                        help="rellena N días solo si no existe $DIR_ANOMALIAS/historia_cargada, y crea esa marca")
    parser.add_argument("--vivo", action="store_true", help="envía de forma continua")
    parser.add_argument("--intervalo", type=int, default=10, help="segundos entre envíos")
    args = parser.parse_args()

    os.makedirs(DIR_ANOMALIAS, exist_ok=True)
    sender = ZabbixSender(server=args.server, port=args.port)
    if args.historia_si_falta:
        marca = os.path.join(DIR_ANOMALIAS, MARCA_HISTORIA)
        if not os.path.exists(marca):
            fallos = enviar(sender, metricas_historia(args.historia_si_falta, datetime.datetime.now()))
            if fallos:
                print(f"!! historia con fallos, se reintenta al reiniciar: {fallos}", flush=True)
            else:
                open(marca, "w").close()
                print(f"OK historia de {args.historia_si_falta} días", flush=True)
    if args.historia:
        fallos = enviar(sender, metricas_historia(args.historia, datetime.datetime.now()))
        print(f"!! historia con fallos: {fallos}" if fallos else f"OK historia de {args.historia} días")
    if args.vivo:
        correr(sender, args.intervalo)


if __name__ == "__main__":
    main()
