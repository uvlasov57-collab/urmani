FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m urmani && mkdir -p /var/lib/urmani && chown urmani:urmani /var/lib/urmani
COPY . .
USER urmani
CMD ["waitress-serve", "--call", "--listen=0.0.0.0:8080", "--max-request-body-size=160000", "server.app:create_app"]
