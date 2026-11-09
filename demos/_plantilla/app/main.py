"""App mínima de la demo PLANTILLA: FastAPI instrumentada con OpenTelemetry. TODO: sustituir por la app real."""
import importlib
import os
import random
import time

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


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
    - OTEL_EXPORTER_OTLP_ENDPOINT: destino del exportador.
    - OTEL_SERVICE_NAMESPACE: service.namespace del recurso (defecto "PLANTILLA").
    - OTEL_DEPLOYMENT_ENVIRONMENT: deployment.environment.name del recurso (defecto "production").
    """
    provider = TracerProvider(resource=Resource.create({
        "service.name": servicio,
        "service.namespace": os.environ.get("OTEL_SERVICE_NAMESPACE", "PLANTILLA"),
        "deployment.environment.name": os.environ.get("OTEL_DEPLOYMENT_ENVIRONMENT", "production"),
    }))
    provider.add_span_processor(BatchSpanProcessor(_exportador()))
    trace.set_tracer_provider(provider)
    # send/receive son spans internos de ASGI: no aportan y multiplican el volumen
    FastAPIInstrumentor.instrument_app(app, excluded_urls="salud", exclude_spans=["send", "receive"])


app = FastAPI(title="PLANTILLA")
instrumentar(app, "PLANTILLA-app")


@app.get("/", response_class=HTMLResponse)
def inicio():
    return "<p>Demo PLANTILLA funcionando</p>"


@app.get("/salud")
def salud():
    return {"estado": "ok"}


@app.get("/trabajo")
def trabajo():
    espera = random.uniform(0.05, 0.3)
    time.sleep(espera)
    return {"operacion": "trabajo", "duracion_ms": round(espera * 1000)}
