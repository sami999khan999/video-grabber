<div align="center">

# Video Grabber

**Paste a video link, pick a format, download it: a Django REST API around yt-dlp with a Next.js frontend.**

![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![Django](https://img.shields.io/badge/Django-5.2-092E20?logo=django&logoColor=white)
![DRF](https://img.shields.io/badge/DRF-3.16-A30000?logo=django&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-FF0000?logo=youtube&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

</div>

---

## About

Video Grabber is a small web app for saving videos from the sites yt-dlp supports. The backend is
a stateless Django REST Framework API (no database, no auth): one endpoint reads a video's
metadata and formats, the other downloads the chosen format to a temporary folder, streams it back
and deletes it. The frontend is a single animated Next.js page with a particle background and a
custom cursor.

## Features

**Backend** (`backend/`)

- `POST /api/info/` runs yt-dlp without downloading and returns the title, thumbnail, duration,
  uploader and a cleaned-up format list: video formats with sound (by resolution, highest first),
  audio-only formats (by bitrate), and a "Best Quality" option on top
- `POST /api/download/` downloads the chosen `format_id` (or `best`, which prefers a single mp4)
  into a temp folder, streams it as an attachment with a sanitised filename, and removes the
  folder once the response is closed
- Settings split into modules (apps, CORS, DRF, i18n, security, logging) plus a `dev` / `prod`
  environment chosen by `DJANGO_ENV`
- A custom DRF exception handler and JSON logs written to `backend/logs/`
- CORS open to the frontend on `localhost:3000`
- Docker image on Python 3.11 Alpine with FFmpeg installed

**Frontend** (`frontend/`)

- One page (`src/app/page.tsx`): a URL field (Enter or the "Grab Video" button), then a results
  view with the thumbnail, title, duration, format count and a download button per format
- API calls through TanStack Query mutations (`src/lib/api.ts`), with loading spinners and error
  messages from the API
- The download arrives as a blob and is saved by the browser
- Framer Motion transitions, a canvas particle system and a trailing custom cursor
- shadcn/ui components (Radix / Base UI) with Tailwind CSS 4

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| Styling / UI | Tailwind CSS 4, shadcn/ui, Framer Motion, lucide-react |
| Data fetching | TanStack Query 5 |
| Backend | Python 3.11, Django 5.2, Django REST Framework 3.16 |
| Video | yt-dlp, FFmpeg (in the Docker image) |
| Other | django-cors-headers, python-dotenv |
| Runtime | Docker Compose (API service) |

## Project structure

```text
backend/
├── apps/downloader/      # views (info, download), services (yt-dlp calls), urls
├── common/
│   ├── exceptions/       # app errors and the DRF exception handler
│   ├── http/             # response helpers
│   └── utils/log.py      # structured logging helper
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── modules/      # apps, cors, drf, i18n, logging, middlewares, security
│   │   └── environments/ # dev.py, prod.py
│   └── urls.py           # /api/ → apps.downloader
├── dockerfile
├── manage.py
└── requirements.txt
frontend/
├── src/app/page.tsx      # the whole UI
├── src/components/       # ParticleSystem, CustomCursor, Providers, ui/ (shadcn)
└── src/lib/api.ts        # calls to the backend
docker-compose.yml        # runs the API on port 8000
```

## API

Base URL: `http://localhost:8000/api`. Both endpoints take JSON.

| Method | Path | Body | What it does |
|---|---|---|---|
| POST | `/api/info/` | `{ "url": "…" }` | metadata and the list of available formats |
| POST | `/api/download/` | `{ "url": "…", "format_id": "best" }` | downloads that format and returns the file |

Errors come back as `400` with `{ "error": "…" }`.

## Getting started

**Prerequisites:** Docker with Compose (or Python 3.11 and FFmpeg), Node.js 20+ and npm.

```bash
git clone https://github.com/sami999khan999/video_grabber.git
cd video_grabber
```

### 1. Backend

Create `backend/.env` from the example and fill in the values:

```bash
cp backend/.env.example backend/.env
```

| Variable | Used for |
|---|---|
| `SECRET_KEY` | Django secret key |
| `LANGUAGE_CODE` | Django language (default `en-us`) |
| `TIME_ZONE` | Django time zone (default `UTC`) |
| `DJANGO_ENV` | optional: `dev` (default) or `prod` settings |

Run it with Docker Compose (the `develop.watch` block syncs code changes into the container):

```bash
docker compose up --build      # or: docker compose watch
```

Or without Docker:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py runserver 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

```bash
npm run build && npm run start # production build
npm run lint
```

The frontend calls the API at `http://127.0.0.1:8000/api` (hard-coded in `src/lib/api.ts`).

## Status

Early, single-commit project. Docker Compose runs only the API; the frontend is started on its
own. Known gaps: the format list on the frontend reads a `resolution` field the API doesn't send
(the API sends `quality`), so every row shows "Auto", and downloaded files are always named
`.mp4`, even audio-only formats.
