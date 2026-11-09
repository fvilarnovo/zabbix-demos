"""Telemetría y estado compartido de los servicios del hotel."""
import importlib
import json
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

DATOS = pathlib.Path(os.environ.get("HOTEL_DATOS", "/datos"))
MODO_ARCHIVO = DATOS / "modo.json"
MODOS = ("normal", "promo", "pagos-lentos", "pagos-error")
TOTAL_HABITACIONES = 320


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
    """Envía las trazas por OTLP. El namespace y el entorno definen el host que crea el discovery de APM.

    Variables de entorno:
    - OTEL_EXPORTER_OTLP_PROTOCOL: `grpc` (defecto, puerto 4317, el que acepta el proxy de Zabbix 8.0)
      o `http/protobuf` (también `http`, puerto 4318).
    - OTEL_EXPORTER_OTLP_ENDPOINT: destino del exportador. En gRPC, `http://host:4317` implica
      conexión sin TLS (el exportador lo deduce del esquema); con `https://` usa TLS.
    - OTEL_SERVICE_NAMESPACE: service.namespace del recurso (defecto "hotel").
    - OTEL_DEPLOYMENT_ENVIRONMENT: deployment.environment.name del recurso (defecto "production").
    """
    provider = TracerProvider(resource=Resource.create({
        "service.name": servicio,
        "service.namespace": os.environ.get("OTEL_SERVICE_NAMESPACE", "hotel"),
        "deployment.environment.name": os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "production"),
    }))
    provider.add_span_processor(BatchSpanProcessor(_exportador()))
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    SQLite3Instrumentor().instrument()
    # send/receive son spans internos de ASGI: no aportan y multiplican el volumen
    FastAPIInstrumentor.instrument_app(app, excluded_urls="salud,demo/estado", exclude_spans=["send", "receive"])


def consulta(ruta, sql, parametros=()):
    """Ejecuta una sentencia con cursor explícito: solo los cursores generan span (`with` y con.execute no)."""
    con = sqlite3.connect(ruta, timeout=5)
    try:
        cursor = con.cursor()
        cursor.execute(sql, parametros)
        filas = cursor.fetchall()
        con.commit()
        return filas
    finally:
        con.close()


def modo():
    try:
        return json.loads(MODO_ARCHIVO.read_text())["modo"]
    except (OSError, ValueError, KeyError):
        return "normal"


def fijar_modo(nuevo):
    temporal = MODO_ARCHIVO.with_suffix(".tmp")
    temporal.write_text(json.dumps({"modo": nuevo}))
    temporal.replace(MODO_ARCHIVO)


def anotar(**atributos):
    """Agrega atributos de negocio (hotel.*) al span de la petición en curso."""
    span = trace.get_current_span()
    for nombre, valor in atributos.items():
        span.set_attribute(f"hotel.{nombre}", valor)
