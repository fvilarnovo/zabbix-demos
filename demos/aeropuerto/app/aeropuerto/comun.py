"""Telemetría compartida de los servicios del recorrido de check-in."""
import importlib
import os
import pathlib
import sqlite3

from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.sqlite3 import SQLite3Instrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

DATOS = pathlib.Path(os.environ.get("ESTADO_DIR", "/estado")) / "datos"
DATOS.mkdir(parents=True, exist_ok=True)


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
        "service.namespace": os.environ.get("OTEL_SERVICE_NAMESPACE", "aeropuerto"),
        "deployment.environment.name": os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "production"),
    }))
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
    """Agrega atributos de negocio (aeropuerto.*) al span de la petición en curso."""
    span = trace.get_current_span()
    for nombre, valor in atributos.items():
        span.set_attribute(f"aeropuerto.{nombre}", valor)
