# ---- Build frontend ----
FROM node:22-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Python backend ----
FROM python:3.13-slim
WORKDIR /app

# Copy & install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy built frontend into the static directory
COPY --from=frontend /build/frontend/out /app/static

EXPOSE 8000

ENV CORS_ORIGINS=""
ENV STATIC_DIR="/app/static"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
