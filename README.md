<div align="center">

# 📺 Video Grabber

### A wall of TVs for [yt-dlp](https://github.com/yt-dlp/yt-dlp)

Paste a video or playlist link, pick any quality (up to 4K) or audio only,
and watch every download come in live on its own TV.

[![Docker Hub](https://img.shields.io/badge/Docker_Hub-sami999%2Fvideo--grabber-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/sami999/video-grabber)
[![Docker version](https://img.shields.io/docker/v/sami999/video-grabber?sort=semver&logo=docker&logoColor=white&label=version)](https://hub.docker.com/r/sami999/video-grabber/tags)
[![Image size](https://img.shields.io/docker/image-size/sami999/video-grabber/latest?logo=docker&logoColor=white&label=image)](https://hub.docker.com/r/sami999/video-grabber/tags)
[![Docker pulls](https://img.shields.io/docker/pulls/sami999/video-grabber?logo=docker&logoColor=white)](https://hub.docker.com/r/sami999/video-grabber)

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Django](https://img.shields.io/badge/Django-5.2-092E20?logo=django&logoColor=white)
![yt-dlp](https://img.shields.io/badge/yt--dlp-latest-FF0000?logo=youtube&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-merge_%26_convert-007808?logo=ffmpeg&logoColor=white)

<img src="docs/screenshots/hero.png" alt="Video Grabber: a pile of TVs and speakers, each busy TV showing a download's thumbnail and live progress, with the download list on the right" width="100%">

</div>

---

## ⚡ Quick start

One container, one port. The image already has the frontend, the API, yt-dlp, FFmpeg and Deno.

```bash
docker run -d --name video-grabber -p 8000:8000 \
  -v video-grabber-data:/data \
  sami999/video-grabber:latest
```

Open **http://localhost:8000**, paste a link, hit **Tune in**, pick what you want and **Grab**.

<details>
<summary><b>Docker Compose</b></summary>

```yaml
services:
  video-grabber:
    image: sami999/video-grabber:latest
    ports:
      - "8000:8000"
    environment:
      MAX_PARALLEL_DOWNLOADS: 3
    volumes:
      - data:/data   # uploaded YouTube cookies survive restarts
    restart: unless-stopped

volumes:
  data:
```

```bash
docker compose up -d
```

</details>

## ✨ Features

| | |
|---|---|
| 🎚️ **Every quality** | Each resolution the site offers, from 144p to 4K/8K, marked with 60fps / HDR, the container you'll get (MP4, or MKV when the codecs need it) and an estimated size |
| 🎧 **Audio only** | Original AAC (M4A) or Opus, or converted to MP3 at 192 kbps |
| 📼 **Playlists** | Lists every video with thumbnails; tick the ones you want, pick one quality cap for all of them and queue them in one go |
| 📡 **Live progress** | Server-Sent Events push percent, size, speed, ETA, which stream (video, then audio) and the merge / convert step |
| 🔀 **Parallel downloads** | A worker pool runs several at once (3 by default); the rest wait on standby. Cancel, retry or remove any of them |
| 💾 **Straight to disk** | Finished files go to the browser's own download manager (auto-save is optional); nothing is held in browser memory |
| 🍪 **YouTube-proof** | Upload a `cookies.txt` from the page when YouTube says *"confirm you're not a bot"*; cookies are only used when the site insists, so they never cost you quality |
| 📱 **Works on phones** | The whole station folds down to a single column |

## 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/formats.png" alt="Single video: every resolution from 4K down to 144p, plus AAC, Opus and MP3"></td>
    <td width="50%"><img src="docs/screenshots/playlist.png" alt="Playlist: thumbnails, per-video toggles and one quality for all"></td>
  </tr>
  <tr>
    <td align="center"><b>Pick any quality</b><br><sub>4K, 1440p, 1080p… or audio only</sub></td>
    <td align="center"><b>Whole playlists</b><br><sub>choose videos, one quality cap, Grab ×N</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/saved.png" alt="Saved files: finished downloads ready to save again"></td>
    <td width="50%"><img src="docs/screenshots/cookies.png" alt="Cookies panel: upload a cookies.txt for YouTube"></td>
  </tr>
  <tr>
    <td align="center"><b>Saved files</b><br><sub>every TV turns green when it's ready</sub></td>
    <td align="center"><b>Cookies</b><br><sub>get past YouTube's bot check</sub></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile.png" alt="The station on a phone" width="300">
</p>

## 🧩 Browser extension

Grab straight from the page you're watching. The extension in [`extension/`](extension/) talks to
your server: its popup lists every quality for the current tab, queues downloads and shows their
progress live. A right-click menu, a badge counting active downloads, notifications and auto-save
to your Downloads folder come with it.

<p align="center">
  <img src="docs/screenshots/extension-playlist.png" alt="Extension popup on a playlist" width="300">
  &nbsp;
  <img src="docs/screenshots/extension-live.png" alt="Extension popup with downloads in progress" width="300">
</p>

**Chrome / Edge / Brave:** `chrome://extensions` → Developer mode → **Load unpacked** → pick
`extension/release/chrome`. **Firefox:** `about:debugging` → **Load Temporary Add-on** → pick
`extension/release/firefox/manifest.json`. Details in [extension/README.md](extension/README.md).

## 🧠 How it works

```mermaid
flowchart LR
    B["Browser<br/>(Next.js static page)"] -- "POST /api/info" --> D["Django API"]
    B -- "POST /api/jobs" --> D
    D -- "Server-Sent Events<br/>/api/jobs/stream" --> B
    D --> P["Job pool<br/>(N parallel)"]
    P --> Y["yt-dlp<br/>+ Deno"]
    Y --> F["FFmpeg<br/>merge / MP3"]
    F --> T[("/downloads<br/>kept 6 h")]
    T -- "GET /api/jobs/:id/file" --> B
```

- **Lookup**: `/api/info/` asks yt-dlp what a link offers, without downloading. Choices are
  heights (`h1080`), not format ids, so a download still works if YouTube hands out a different
  client's formats a minute later.
- **Jobs**: each choice becomes a job in an in-memory pool. yt-dlp's progress hooks update it, and
  every change goes out to all open tabs over one event stream.
- **Files**: video and audio streams are merged by FFmpeg (MP3 is converted), served once finished
  and deleted after `JOB_TTL_HOURS`.
- **Pacing**: polite mode limits and spaces each site's downloads (see below).
- **YouTube**: requests go out without cookies first. Only if YouTube demands a signed-in user is
  the request repeated with your cookies. A job that comes out below the chosen resolution says so.

## ⚙️ Configuration

Pass with `-e NAME=value` (or `environment:` in Compose).

| Variable | Default | What it does |
|---|---|---|
| `MAX_PARALLEL_DOWNLOADS` | `3` | Downloads that run at the same time; the rest wait |
| `POLITE_MODE` | `1` | Pace traffic per site (below); `0` turns it off |
| `PER_SITE_PARALLEL` | `2` | Most downloads from one site at once, in polite mode |
| `START_GAP_MIN` / `START_GAP_MAX` | `3` / `8` | Random seconds between starting downloads from one site |
| `REQUEST_SLEEP` | `1` | Seconds yt-dlp waits between its own requests |
| `INFO_CACHE_MINUTES` | `10` | How long a link lookup is reused instead of asked again |
| `JOB_TTL_HOURS` | `6` | How long finished files stay on the server |
| `ALLOWED_HOSTS` | `*` | Comma-separated host names the app answers to |
| `SECRET_KEY` | built-in fallback | Django secret key (nothing signs with it today, set it anyway) |
| `DATA_DIR` | `/data` | Where uploaded cookies live; mount a volume here |
| `DOWNLOAD_DIR` | `/downloads` | Where jobs write their files (emptied on start) |
| `COOKIES_FILE` | unset | A mounted `cookies.txt` to use when none was uploaded |
| `WEB_THREADS` | `32` | Gunicorn threads; each open tab holds one for its live stream |
| `TIME_ZONE` / `LANGUAGE_CODE` | `UTC` / `en-us` | Django localisation |

> [!NOTE]
> Jobs live in memory, so the app runs as a single Gunicorn process. Restarting the container
> clears the queue and the finished files (uploaded cookies stay in `/data`).

## 🐢 Polite mode (on by default)

Sites block addresses that send bursts of requests, so the server paces itself: at most 2 downloads
per site at once, a random 3–8 s gap between starting them, a 1 s pause between yt-dlp's own
requests, lookups reused for 10 minutes, and a longer random wait before retrying a refused stream.
A 50-video playlist trickles in instead of hitting the site all at once. Nothing can promise a site
will never block you, but this keeps the traffic looking like a person rather than a bot.

## 🍪 YouTube says "Sign in to confirm you're not a bot"

YouTube says that to IP addresses it distrusts: servers, VPNs, or lots of requests in a short time.
It's about the address, not the link, and it often lifts after a while. To get past it:

1. Log in to YouTube in your browser (a spare account is safest).
2. Export the cookies as `cookies.txt` with an extension such as **Get cookies.txt LOCALLY**.
3. In the app, open **Cookies** and upload the file. The top bar shows **Cookies on**.

> [!WARNING]
> The app has no login. Anyone who can open the page can queue downloads and use the account
> behind the cookies. Keep it on your own machine or network, or put it behind a proxy with
> authentication.

## 🔌 API

Base URL `/api`, JSON bodies.

| Method | Path | Body | Does |
|---|---|---|---|
| `GET` | `/status/` | | `{ max_parallel, cookies }` |
| `POST` | `/info/` | `{ url }` | Video formats, or playlist entries (`kind` says which) |
| `GET` | `/jobs/` | | All jobs |
| `POST` | `/jobs/` | `{ items: [{ url, format_id, label?, title?, thumbnail?, group? }] }` | Queues one job per item |
| `GET` | `/jobs/stream/` | | Server-Sent Events: `{ jobs: [...] }` on every change |
| `POST` | `/jobs/:id/cancel/` | | Stops a job, keeps it listed |
| `POST` | `/jobs/:id/retry/` | | Replaces a failed or cancelled job |
| `DELETE` | `/jobs/:id/` | | Cancels if needed, removes the job and its file |
| `POST` | `/jobs/clear/` | | Removes finished, failed and cancelled jobs |
| `GET` | `/jobs/:id/file/` | | The finished file |
| `POST` / `DELETE` | `/cookies/` | multipart `file` | Stores / forgets an uploaded `cookies.txt` |

`format_id`: `best`, an exact height from `/info/` (`h2160`, `h1080`…), a cap for playlists
(`1080p`), `audio` (M4A), `audio-opus`, `audio-mp3`, or any raw yt-dlp format selector.

<details>
<summary><b>Example: queue a 1080p download and an MP3 from the command line</b></summary>

```bash
curl -X POST http://localhost:8000/api/jobs/ -H 'Content-Type: application/json' -d '{
  "items": [
    { "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "format_id": "h1080" },
    { "url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "format_id": "audio-mp3" }
  ]
}'
curl -N http://localhost:8000/api/jobs/stream/   # watch them come in
```

</details>

## 🛠️ Development

**Needs:** Python 3.11, FFmpeg, [Deno](https://deno.com) (yt-dlp uses it for YouTube), Node.js 20+
and pnpm.

```bash
# API on :8000
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py runserver 8000

# UI on :3000 (talks to the API on :8000; override with NEXT_PUBLIC_API_BASE)
cd frontend
pnpm install
pnpm dev
```

`pnpm build` writes a static export to `frontend/out`, which Django serves at `/` (that's how the
image works). Build the image yourself with `docker build -t video-grabber .`; add `--no-cache`
to pick up the newest yt-dlp.

<details>
<summary><b>Project structure</b></summary>

```text
backend/
├── apps/downloader/
│   ├── jobs.py           # job pool: progress, cancel, retry, cleanup
│   ├── services.py       # /info/: formats and playlist entries
│   ├── ytdlp.py          # yt-dlp runner, cookies (upload + fallback)
│   └── views.py, urls.py
├── common/               # errors, logging helpers
└── config/settings/      # split settings, dev / prod, WhiteNoise for the UI
frontend/
├── src/app/page.tsx      # the station
├── src/app/wall.css      # TVs, speakers, stickers, pills
├── src/components/wall/  # TvWall, TopBar, SideRail, panels, BottomBar
├── src/hooks/use-jobs.ts # live job list (Server-Sent Events)
└── src/lib/api.ts
extension/                # browser extension: src/, release/chrome, release/firefox
Dockerfile                # Node builds the UI, Python + FFmpeg + Deno run it all
docker-compose.yml
```

</details>

## 🙏 Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) does the real work; [FFmpeg](https://ffmpeg.org)
  merges and converts; [Deno](https://deno.com) runs YouTube's JavaScript for yt-dlp.
- The video in the screenshots is *Big Buck Bunny* © Blender Foundation,
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The other thumbnails are generated
  FFmpeg test patterns.

> Only download what you have the right to download, and respect the terms of the sites you use.
