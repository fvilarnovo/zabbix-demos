"""Telemetría compartida de los servicios de recaudo de peajes (OpenTelemetry → proxy APM de Zabbix 8.0)."""
import importlib
import os
import pathlib
import sqlite3
import sys

from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlite3 import SQLite3Instrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
import estado_demo  # noqa: E402,F401  (lo usan los servicios para leer los escenarios)

DATOS = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado")) / "datos"
DATOS.mkdir(parents=True, exist_ok=True)

GATEWAY = os.environ.get("GATEWAY_URL", "http://127.0.0.1:8111")
VALIDACION = os.environ.get("VALIDACION_URL", "http://127.0.0.1:8112")
OPERADOR = os.environ.get("OPERADOR_URL", "http://127.0.0.1:8113")
TARIFAS = os.environ.get("TARIFAS_URL", "http://127.0.0.1:8114")
TRANSACCIONES = os.environ.get("TRANSACCIONES_URL", "http://127.0.0.1:8115")


def _exportador():
    """Crea el exportador OTLP según OTEL_EXPORTER_OTLP_PROTOCOL (import diferido)."""
    protocolo = os.environ.get("OTEL_EXPORTER_OTLP_PROTOCOL", "grpc").strip().lower()
    if protocolo == "grpc":
        modulo = "opentelemetry.exporter.otlp.proto.grpc.trace_exporter"
    elif protocolo in ("http/protobuf", "http"):
        modulo = "opentelemetry.exporter.otlp.proto.http.trace_exporter"
    else:
        raise ValueError(f"OTEL_EXPORTER_OTLP_PROTOCOL no soportado: {protocolo!r} (use grpc o http/protobuf)")
    return importlib.import_module(modulo).OTLPSpanExporter()


def instrumentar(app, servicio):
    """Envía las trazas por OTLP. El namespace y el entorno definen el host que crea el discovery de APM."""
    provider = TracerProvider(resource=Resource.create({
        "service.name": servicio,
        "service.namespace": os.environ.get("OTEL_SERVICE_NAMESPACE", "autopista"),
        "deployment.environment.name": os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "production"),
    }))
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        provider.add_span_processor(BatchSpanProcessor(_exportador()))
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    SQLite3Instrumentor().instrument()
    # send/receive son spans internos de ASGI: no aportan y multiplican el volumen
    FastAPIInstrumentor.instrument_app(app, excluded_urls="salud", exclude_spans=["send", "receive"])


def consulta(ruta, sql, parametros=()):
    """Ejecuta una sentencia con cursor explícito: solo los cursores generan span."""
    con = sqlite3.connect(ruta, timeout=5)
    try:
        cursor = con.cursor()
        cursor.execute(sql, parametros)
        filas = cursor.fetchall()
        con.commit()
        return filas
    finally:
        con.close()


def anotar(**atributos):
    """Agrega atributos de negocio (peaje.*) al span de la petición en curso."""
    span = trace.get_current_span()
    for nombre, valor in atributos.items():
        if valor is not None:
            span.set_attribute(f"peaje.{nombre}", valor)


def trace_id():
    return format(trace.get_current_span().get_span_context().trace_id, "032x")


def heap_gateway(edad_seg):
    """Memoria del gateway durante la fuga: sube hasta el reinicio y vuelve a empezar (ciclo de 150 s reales).

    Devuelve (heap_pct, reiniciando). La comparten el gateway (latencia real) y el simulador (métrica de infraestructura).
    """
    if edad_seg is None:
        return 46.0, False
    fase = edad_seg % 150
    if fase >= 140:
        return 18.0, True
    return min(99.0, 52 + fase * 0.34), False
