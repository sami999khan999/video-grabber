# One image: Next.js frontend (static export) + Django API, served together on port 7845.

# --- 1. Build the frontend -------------------------------------------------
FROM node:22-alpine AS frontend

WORKDIR /frontend
RUN npm install -g pnpm@10

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
# The API is on the same origin as the page in this image
ENV NEXT_PUBLIC_API_BASE=/api
RUN pnpm build


# --- 2. Deno, the JavaScript runtime yt-dlp needs for YouTube -------------
FROM denoland/deno:bin-2.9.7 AS deno


# --- 3. Runtime: Django API + the built frontend --------------------------
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_ENV=prod \
    FRONTEND_DIR=/app/frontend \
    DOWNLOAD_DIR=/downloads \
    DATA_DIR=/data \
    MAX_PARALLEL_DOWNLOADS=0 \
    JOB_TTL_HOURS=6 \
    PORT=7845

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/ ./
COPY --from=frontend /frontend/out ./frontend

RUN useradd --create-home --uid 1000 app \
    && mkdir -p /app/logs /downloads /data \
    && chown -R app:app /app/logs /downloads /data
USER app

EXPOSE 7845

# Jobs are kept in memory, so there is exactly one process; threads serve the
# requests and the live progress streams (one per open tab), downloads run in their own pool.
CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT} --workers 1 --threads ${WEB_THREADS:-32} --timeout ${WEB_TIMEOUT:-120} --graceful-timeout 5 --access-logfile -"]
