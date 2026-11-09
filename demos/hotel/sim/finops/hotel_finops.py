"""Costo diario de las aplicaciones del hotel por proveedor. Los datos son ficticios.

No es un servicio aparte: finops_simulator.py lo llama en cada envío, con los mismos costos que manda a
AWS y GCP. Así, la suma de las aplicaciones de un proveedor coincide con el total de ese proveedor.
"""
HOST = "Hotel Gran Forum - FinOps"
PROVEEDORES = {"aws": "AWS", "gcp": "GCP"}
APLICACIONES = ["pms", "reservas-web", "portal-wifi", "analitica"]

# Parte del costo normal de cada proveedor que consume cada aplicación
REPARTO = {
    "aws": {"pms": 0.40, "reservas-web": 0.35, "portal-wifi": 0.15, "analitica": 0.10},
    "gcp": {"pms": 0.05, "reservas-web": 0.15, "portal-wifi": 0.05, "analitica": 0.75},
}
# Aplicación a la que se le carga la anomalía: el EC2 de DR es del PMS y BigQuery es de analítica
APP_ANOMALIA = {"aws": "pms", "gcp": "analitica"}


def clave(aplicacion, proveedor):
    return f"hotel.finops.costo[{aplicacion},{proveedor}]"


def metricas_hotel(costos, clock):
    """costos: {proveedor: (costo normal, espiga)}. Solo usa AWS y GCP."""
    salida = []
    for proveedor in PROVEEDORES:
        normal, espiga = costos[proveedor]
        for aplicacion, parte in REPARTO[proveedor].items():
            valor = normal * parte + (espiga if aplicacion == APP_ANOMALIA[proveedor] else 0)
            salida.append({"host": HOST, "key": clave(aplicacion, proveedor), "value": round(valor, 2), "clock": clock})
    return salida
