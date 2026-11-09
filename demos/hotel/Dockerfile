# Demo "Hotel Gran Zabbix 8.0" en un solo contenedor: webapp (4 servicios + carga), simuladores OT y FinOps,
# vista pixel art, servicio de control y provisioning de Zabbix al arrancar. Ver supervisor.py y .env.example.
FROM python:3.12-slim
WORKDIR /srv
COPY app/requirements.txt app/requirements.txt
RUN pip install --no-cache-dir -r app/requirements.txt
COPY app/hotel app/hotel
COPY sim sim
COPY pixel pixel
COPY control control
COPY provision provision
COPY supervisor.py .
RUN mkdir -p /estado /salida
ENV PYTHONUNBUFFERED=1 ESTADO_DIR=/estado
EXPOSE 8000 8090 8091
VOLUME ["/estado", "/salida"]
CMD ["python3", "-u", "supervisor.py"]
