# Demo "PLANTILLA" en un solo contenedor: la app y el provisioning de Zabbix. Ver supervisor.py, procesos.json y .env.example.
FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /estado /salida
ENV PYTHONUNBUFFERED=1 ESTADO_DIR=/estado
EXPOSE 8000
CMD ["python3", "-u", "supervisor.py"]
