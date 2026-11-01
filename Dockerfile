# Etapa 1: Compilar la UI en SolidJS
FROM node:20-alpine AS frontend-builder
WORKDIR /app/admin-ui
COPY admin-ui/package*.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

# Etapa 2: Servidor Python
FROM python:3.11-slim
WORKDIR /app

# Evita que Python escriba archivos .pyc e imprime logs directo a la consola
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Instalar dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el código fuente
COPY titan_vault/ ./titan_vault/
COPY vault.py .

# Copiar los estáticos de la UI compilados en la Etapa 1
COPY --from=frontend-builder /app/admin-ui/dist ./admin-ui/dist

# Exponer el puerto
EXPOSE 8200

# Ejecutar el servidor
CMD ["uvicorn", "titan_vault.api:app", "--host", "0.0.0.0", "--port", "8200"]
