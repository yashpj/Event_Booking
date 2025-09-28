FROM python:3.9-slim

WORKDIR /app

COPY requirements-deploy.txt .
RUN pip install --no-cache-dir -r requirements-deploy.txt

COPY . .

EXPOSE 8000

CMD uvicorn main:socket_app --host 0.0.0.0 --port ${PORT:-8000}