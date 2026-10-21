import os
import re
import shutil
import tempfile
import threading
import time
import uuid

from yt_dlp.utils import DownloadCancelled

from common.utils.log import log

from .limits import SpeedLimiter, speed_limit
from .politeness import gate, polite_options, retry_pause
from .ytdlp import clean_headers, extract, mix_video_url

# Jobs live in memory, so the app must run as a single process (threads are fine).
# 0 starts every download straight away; a number makes the rest wait (priority ones first)
MAX_PARALLEL_DOWNLOADS = max(0, int(os.environ.get("MAX_PARALLEL_DOWNLOADS", "0")))
# While one download has priority, every other one is held to this speed so it gets the bandwidth
BACKGROUND_KBPS = float(os.environ.get("BACKGROUND_KBPS", "256"))
# HLS/DASH videos come in many small pieces; fetching several at once is what makes them fast
FRAGMENT_PARALLEL = max(1, int(os.environ.get("FRAGMENT_PARALLEL", "8")))
# Plain files are asked for in chunks of this size: servers that throttle one long request
# (YouTube does) serve each fresh chunk at full speed
HTTP_CHUNK_MB = float(os.environ.get("HTTP_CHUNK_MB", "10"))
# Seconds the speed shown for a limited download is averaged over
RATE_WINDOW = 4
JOB_TTL_SECONDS = float(os.environ.get("JOB_TTL_HOURS", "6")) * 3600
DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR") or os.path.join(
    tempfile.gettempdir(), "video-grabber"
)

# Paused jobs keep their partial files and pick up where they stopped when resumed
ACTIVE = {"queued", "starting", "downloading", "processing", "merging", "paused"}
FINISHED = {"done", "error", "cancelled"}

# Video joins the AAC track when there is one, so most downloads fit in mp4
PRESETS = {
    "best": "bv*+ba[ext=m4a]/bv*+ba/b",
    "audio": "ba[ext=m4a]/ba/b",
    "audio-opus": "ba[acodec^=opus]/ba",
    # Converted to mp3 afterwards (see MP3_POSTPROCESSOR); any audio will do as the source
    "audio-mp3": "ba/b",
}

# The connection itself failed (a dropped link, DNS hiccup, too many at once): worth one more try
NETWORK_ERROR = re.compile(
    r"Network is unreachable|Failed to establish a new connection|Connection (reset|refused|aborted)"
    r"|timed out|Temporary failure in name resolution|Name or service not known|RemoteDisconnected",
    re.I,
)

MP3_POSTPROCESSOR = {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}

STAGE_NAMES = {
    "Merger": "Merging streams",
    "ExtractAudio": "Converting to MP3",
    "FixupM3u8": "Fixing stream",
    "FixupM4a": "Fixing audio",
}


def format_selector(format_id: str) -> str:
    """
    Turn what the client sent into a yt-dlp format selector: a preset ("best", "audio",
    "audio-mp3", ...), an exact height from /api/info/ ("h1080"), a height cap for
    playlists ("720p"), or a raw yt-dlp selector.
    """
    if not format_id:
        return PRESETS["best"]
    if format_id in PRESETS:
        return PRESETS[format_id]
    exact = re.fullmatch(r"h(\d{2,4})", format_id)
    if exact:
        h = exact.group(1)
        # That height (H.264 first, for compatibility), then the nearest lower one
        return (
            f"bv*[height={h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height={h}]+ba[ext=m4a]/"
            f"bv*[height={h}]+ba/b[height={h}]/bv*[height<={h}]+ba/b[height<={h}]/b"
        )
    cap = re.fullmatch(r"(\d{3,4})p", format_id)
    if cap:
        h = cap.group(1)
        return f"bv*[height<={h}]+ba[ext=m4a]/bv*[height<={h}]+ba/b[height<={h}]/b"
    return format_id


def clean_error(exc: Exception) -> str:
    message = str(exc) or exc.__class__.__name__
    if re.search(r"confirm you.re not a bot|Sign in to confirm", message):
        return (
            "YouTube is blocking this server and wants a signed-in user "
            "(\"confirm you're not a bot\"). Send your YouTube login with the browser "
            "extension, or upload a cookies.txt in the Cookies tab, then try again."
        )
    message = re.sub(r"^ERROR:\s*", "", message)
    if message.startswith("Unsupported URL"):
        return (
            "No video found at this link. Either the site isn't supported, or the page needs "
            "you to be logged in (a login or private page, like a chat)."
        )
    if "is not a valid URL" in message:
        return "That doesn't look like a link. Paste the full address, starting with https://."
    if "DRM" in message:
        return "This video is DRM-protected (like on Netflix or Spotify), so it can't be downloaded."
    if "HTTP Error 404" in message:
        return "The site says this page doesn't exist (404). Check the link."
    if "HTTP Error 403" in message:
        return "The site refused the request (403). Try again in a little while."
    if NETWORK_ERROR.search(message):
        host = re.search(r"host='([^']+)'", message)
        where = f" ({host.group(1)})" if host else ""
        return f"Couldn't connect to the site{where}: the server's internet connection dropped or timed out. Try again."
    # "[generic] abc123: Unable to ... (caused by <HTTPError ...>)" -> "Unable to ..."
    message = re.sub(r"^\[[\w:]+\]\s+[^:]+:\s*", "", message)
    message = re.sub(r"\s*\(caused by .*\)\s*$", "", message)
    return message


class Job:
    def __init__(self, url, format_id, label=None, title=None, thumbnail=None, group=None,
                 headers=None, cookie_text=None):
        self.id = uuid.uuid4().hex[:12]
        self.url = url
        # Sent by the browser extension for this download only; never listed or logged
        self.headers = headers or {}
        self.cookie_text = cookie_text
        self.format_id = format_id or "best"
        self.label = label or self.format_id
        self.title = title or ""
        self.thumbnail = thumbnail or ""
        self.group = group
        self.status = "queued"
        self.stage = ""
        self.progress = 0.0
        self.downloaded_bytes = 0
        self.total_bytes = None
        self.speed = None
        self.eta = None
        self.stream = ""
        self.streams_done = 0
        self.filepath = None
        self.filename = None
        self.filesize = None
        self.error = None
        # Something worth knowing about a finished job, e.g. it came out below the chosen quality
        self.notice = None
        self.created_at = time.time()
        self.finished_at = None
        # The one download the user wants first: it skips the line and the others slow down
        self.priority = False
        # Set (with cancel_event) to stop the download but keep its partial files for a resume
        self.pausing = False
        self.cancel_event = threading.Event()
        # (time, bytes) the background speed limit counts from
        self.throttle_mark = None
        # Bytes of the current stream already counted against the total speed limit
        self.limit_bytes = None
        # Recent (time, bytes) readings, for the speed shown while a limit slows this download
        self.rate_samples = []

    @property
    def dir(self):
        return os.path.join(DOWNLOAD_DIR, self.id)

    def to_dict(self):
        return {
            "id": self.id,
            "url": self.url,
            "format_id": self.format_id,
            "label": self.label,
            "title": self.title,
            "thumbnail": self.thumbnail,
            "group": self.group,
            "status": self.status,
            "stage": self.stage,
            "progress": round(self.progress, 1),
            "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes,
            "speed": self.speed,
            "eta": self.eta,
            "stream": self.stream,
            "filename": self.filename,
            "filesize": self.filesize,
            "error": self.error,
            "notice": self.notice,
            "priority": self.priority,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    def __init__(self):
        self._jobs = {}
        self._cond = threading.Condition()
        self._version = 0
        # Jobs not started yet (only when MAX_PARALLEL_DOWNLOADS is set), and how many run
        self._waiting = []
        self._running = 0
        self._limiter = SpeedLimiter()
        # Files from a previous run have no job left pointing at them
        shutil.rmtree(DOWNLOAD_DIR, ignore_errors=True)
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)
        threading.Thread(target=self._sweep_loop, daemon=True).start()

    # --- state -------------------------------------------------------------

    def _touch(self):
        with self._cond:
            self._version += 1
            self._cond.notify_all()

    def _update(self, job, **fields):
        with self._cond:
            for key, value in fields.items():
                setattr(job, key, value)
            self._version += 1
            self._cond.notify_all()

    def snapshot(self):
        with self._cond:
            return self._version, [job.to_dict() for job in self._jobs.values()]

    def wait_for_change(self, since, timeout):
        """Block until the state is newer than `since` (or the timeout passes)."""
        with self._cond:
            self._cond.wait_for(lambda: self._version != since, timeout=timeout)
            return self._version, [job.to_dict() for job in self._jobs.values()]

    def get(self, job_id):
        with self._cond:
            return self._jobs.get(job_id)

    # --- actions -----------------------------------------------------------

    def create(self, items):
        jobs = []
        for item in items:
            job = Job(
                # Also mends Mix jobs queued before feeds turned them into videos (on retry)
                url=mix_video_url(item["url"]) or item["url"],
                format_id=item.get("format_id"),
                label=item.get("label"),
                title=item.get("title"),
                thumbnail=item.get("thumbnail"),
                group=item.get("group"),
                headers=clean_headers(item.get("headers")),
                cookie_text=item.get("cookies") or None,
            )
            with self._cond:
                self._jobs[job.id] = job
                self._waiting.append(job)
            jobs.append(job)
        self._dispatch()
        self._touch()
        return jobs

    def _dispatch(self):
        """Start waiting jobs while there is room, priority ones first."""
        with self._cond:
            while self._waiting and (MAX_PARALLEL_DOWNLOADS == 0 or self._running < MAX_PARALLEL_DOWNLOADS):
                job = next((j for j in self._waiting if j.priority), self._waiting[0])
                self._waiting.remove(job)
                self._running += 1
                threading.Thread(target=self._work, args=(job,), daemon=True,
                                 name=f"download-{job.id}").start()

    def _work(self, job):
        try:
            self._run(job)
        finally:
            with self._cond:
                self._running -= 1
            self._dispatch()

    def _unqueue(self, job):
        """Take a job out of the line before it starts; False when it already runs."""
        with self._cond:
            if job not in self._waiting:
                return False
            self._waiting.remove(job)
            return True

    def cancel(self, job_id):
        job = self.get(job_id)
        if not job or job.status in FINISHED:
            return job
        job.pausing = False
        job.cancel_event.set()
        # A job still waiting in line never starts; a paused one has no thread to clean up after it
        if self._unqueue(job) or job.status == "paused":
            shutil.rmtree(job.dir, ignore_errors=True)
            self._update(job, status="cancelled", finished_at=time.time())
        return job

    def pause(self, job_id):
        """Stop a download but keep what it has so far. Not while it joins or converts the file."""
        job = self.get(job_id)
        if not job or job.status not in ("queued", "starting", "downloading"):
            return job
        job.pausing = True
        job.cancel_event.set()
        # Still waiting in line: nothing runs to notice, so it's paused right away
        if self._unqueue(job):
            self._update(job, status="paused", stage="", speed=None, eta=None)
        else:
            self._touch()
        return job

    def resume(self, job_id):
        """Put a paused download back in line; yt-dlp continues from the partial files."""
        with self._cond:
            job = self._jobs.get(job_id)
            if not job or job.status != "paused":
                return job
            job.pausing = False
            job.cancel_event.clear()
            # yt-dlp reports streams that are already complete as finished again
            job.streams_done = 0
            job.status = "queued"
            job.stage = ""
            self._waiting.append(job)
            self._version += 1
            self._cond.notify_all()
        self._dispatch()
        return job

    def prioritize(self, job_id, on=True):
        """Give one download priority (taking it from any other), or take it away."""
        with self._cond:
            job = self._jobs.get(job_id)
            if not job or job.status in FINISHED:
                return job
            for other in self._jobs.values():
                other.priority = False
            job.priority = on
            self._version += 1
            self._cond.notify_all()
        self._dispatch()
        return job

    def remove(self, job_id):
        return self.remove_many([job_id]) == 1

    def remove_many(self, job_ids):
        """Drop jobs from the list at once, stopping any that still run."""
        with self._cond:
            jobs = [self._jobs.pop(i) for i in job_ids if i in self._jobs]
        if not jobs:
            return 0
        leftovers = []
        for job in jobs:
            job.cancel_event.set()
            # A job still waiting in line never starts; a running one deletes
            # its own folder when it notices the cancel
            if self._unqueue(job) or job.status in FINISHED or job.status == "paused":
                leftovers.append(job.dir)
        self._touch()
        if leftovers:
            threading.Thread(target=_remove_dirs, args=(leftovers,), daemon=True).start()
        return len(jobs)

    def retry(self, job_id):
        job = self.get(job_id)
        if not job:
            return None
        self.remove(job_id)
        return self.create([{
            "url": job.url,
            "format_id": job.format_id,
            "label": job.label,
            "title": job.title,
            "thumbnail": job.thumbnail,
            "group": job.group,
            "headers": job.headers,
            "cookies": job.cookie_text,
        }])[0]

    def clear(self, everything=False):
        with self._cond:
            ids = [j.id for j in self._jobs.values() if everything or j.status in FINISHED]
        return self.remove_many(ids)

    # --- download ----------------------------------------------------------

    def _run(self, job):
        if job.cancel_event.is_set():
            return
        os.makedirs(job.dir, exist_ok=True)

        opts = dict(
            noprogress=True,
            noplaylist=True,
            outtmpl=os.path.join(job.dir, "%(id)s.%(ext)s"),
            # Merged video + audio goes into mp4 when the codecs allow it, mkv otherwise
            merge_output_format="mp4/mkv",
            format=format_selector(job.format_id),
            concurrent_fragment_downloads=FRAGMENT_PARALLEL,
            progress_hooks=[lambda d: self._on_progress(job, d)],
            postprocessor_hooks=[lambda d: self._on_postprocess(job, d)],
            **polite_options(),
        )
        if HTTP_CHUNK_MB > 0:
            opts["http_chunk_size"] = int(HTTP_CHUNK_MB * 1024 * 1024)
        if job.format_id == "audio-mp3":
            opts["postprocessors"] = [MP3_POSTPROCESSOR]

        try:
            log("info", f"Job {job.id}: downloading {job.url} as {job.format_id}")
            # Polite mode: wait for one of the site's few slots and its spacing between starts
            with gate.slot(job.url, job.cancel_event, lambda stage: self._update(job, status="queued", stage=stage),
                           urgent=lambda: job.priority):
                self._update(job, status="starting", stage="Resolving")
                # YouTube now and then refuses a stream with 403 (often when several downloads of
                # the same video run at once), and a connection can drop; a second try, after a
                # pause, usually gets through
                for attempt in (1, 2):
                    try:
                        info = extract(job.url, download=True, headers=job.headers,
                                       cookie_text=job.cookie_text, **opts)
                        break
                    except DownloadCancelled:
                        raise
                    except Exception as exc:
                        if attempt == 2 or job.cancel_event.is_set() or not (
                            "HTTP Error 403" in str(exc) or NETWORK_ERROR.search(str(exc))
                        ):
                            raise
                        log("warning", f"Job {job.id}: {str(exc)[:120]}, trying once more")
                        self._update(job, status="starting", stage="Retrying shortly", progress=0.0, streams_done=0)
                        retry_pause(job.cancel_event)

            # requested_downloads holds the final path (after merging); fall back
            # to the largest file in the job folder
            downloads = info.get("requested_downloads") or []
            filepath = downloads[0].get("filepath") if downloads else None
            if not filepath or not os.path.exists(filepath):
                files = [os.path.join(job.dir, n) for n in os.listdir(job.dir)]
                files = [f for f in files if not f.endswith(".part")]
                if not files:
                    raise ValueError("Download finished but no file was produced.")
                filepath = max(files, key=os.path.getsize)

            title = job.title or info.get("title") or "video"
            safe_title = "".join(
                c for c in title if c.isalnum() or c in " .-_()[]"
            ).strip() or "video"
            ext = os.path.splitext(filepath)[1]

            notice = None
            wanted = re.fullmatch(r"h(\d{2,4})", job.format_id)
            got = info.get("height")
            if wanted and got and got < int(wanted.group(1)):
                notice = (
                    f"Got {got}p instead of {wanted.group(1)}p: the site only offered up to "
                    f"{got}p for this download. Try again later for the full quality."
                )

            self._update(
                job,
                status="done",
                stage="Ready",
                progress=100.0,
                title=title,
                thumbnail=job.thumbnail or info.get("thumbnail") or "",
                filepath=filepath,
                filename=f"{safe_title}{ext}",
                filesize=os.path.getsize(filepath),
                speed=None,
                eta=None,
                notice=notice,
                priority=False,
                pausing=False,
                finished_at=time.time(),
                # The login was only needed to fetch the file
                cookie_text=None,
            )
            log("info", f"Job {job.id}: done", payload={"file": filepath})
            # Removed while it was finishing up: nothing points at the file any more
            if self.get(job.id) is None:
                shutil.rmtree(job.dir, ignore_errors=True)
        except Exception as exc:
            if job.pausing and self.get(job.id) is not None:
                # Keep the partial files: a resume continues from them
                self._update(job, status="paused", stage="", speed=None, eta=None)
                log("info", f"Job {job.id}: paused")
                return
            shutil.rmtree(job.dir, ignore_errors=True)
            if job.cancel_event.is_set() or isinstance(exc, DownloadCancelled):
                self._update(job, status="cancelled", stage="", speed=None, eta=None,
                             priority=False, finished_at=time.time())
            else:
                log("warning", f"Job {job.id}: failed", payload={"error": str(exc)})
                self._update(job, status="error", stage="", error=clean_error(exc),
                             speed=None, eta=None, priority=False, finished_at=time.time())

    def _on_progress(self, job, d):
        if job.cancel_event.is_set():
            raise DownloadCancelled("Cancelled")

        info = d.get("info_dict") or {}
        # Video + audio downloads report each stream separately, one after the other
        streams = len(info.get("requested_formats") or []) or 1
        fields = {}
        if not job.title and info.get("title"):
            fields["title"] = info["title"]
        if not job.thumbnail and info.get("thumbnail"):
            fields["thumbnail"] = info["thumbnail"]

        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            done = d.get("downloaded_bytes") or 0
            if total:
                fraction = min(done / total, 1.0)
            elif d.get("fragment_count"):
                fraction = (d.get("fragment_index") or 0) / d["fragment_count"]
            else:
                fraction = 0.0
            index = min(job.streams_done, streams - 1)
            speed, eta = d.get("speed"), d.get("eta")
            if speed_limit() or job.throttle_mark is not None:
                # yt-dlp times only the reads, not the pauses between them, so it would show
                # the full speed; measure what actually arrived over the last few seconds
                speed = self._measured_speed(job, done)
                eta = (total - done) / speed if speed and total and total > done else eta
            kind = ""
            if streams > 1:
                vcodec = info.get("vcodec") or "none"
                kind = "Video" if vcodec != "none" else "Audio"
            self._update(
                job,
                status="downloading",
                stage=f"{kind} stream" if kind else "Downloading",
                progress=min((index + fraction) / streams * 100, 99.0),
                downloaded_bytes=done,
                total_bytes=total,
                speed=speed,
                eta=eta,
                stream=f"{index + 1}/{streams}" if streams > 1 else "",
                **fields,
            )
            self._hold_back(job, done)
            self._cap_speed(job, done)
        elif d["status"] == "finished":
            self._update(job, streams_done=job.streams_done + 1, **fields)

    @staticmethod
    def _measured_speed(job, done):
        """Bytes per second over the last few seconds (None until there is enough to tell)."""
        now = time.monotonic()
        samples = job.rate_samples
        # Each stream counts its bytes from zero again
        if samples and done < samples[-1][1]:
            samples.clear()
        samples.append((now, done))
        while len(samples) > 2 and now - samples[1][0] >= RATE_WINDOW:
            samples.pop(0)
        since, start = samples[0]
        return (done - start) / (now - since) if now - since >= 1 else None

    def _hold_back(self, job, done):
        """
        Slow this download to BACKGROUND_KBPS while another one has priority. Called from
        yt-dlp's progress hook, so sleeping here stalls the read and the server slows down too.
        """
        # In short naps, rechecking each time, so a priority change or a cancel takes effect quickly
        while True:
            with self._cond:
                yielding = BACKGROUND_KBPS > 0 and not job.priority and any(
                    # Not while it still waits for a turn: slowing the others would only delay it
                    j.priority and j.status in ("starting", "downloading")
                    for j in self._jobs.values()
                )
            background = BACKGROUND_KBPS
            if speed_limit():
                # Under a total limit too, so the priority download keeps most of it
                background = min(background, speed_limit() / 8)
            now = time.monotonic()
            # Each stream counts its bytes from zero again
            if not yielding or job.throttle_mark is None or done < job.throttle_mark[1]:
                job.throttle_mark = (now, done) if yielding else None
                return
            since, start_bytes = job.throttle_mark
            wait = (done - start_bytes) / (background * 1024) - (now - since)
            if wait <= 0:
                return
            if job.cancel_event.wait(min(wait, 1.0)):
                raise DownloadCancelled("Cancelled")

    def _cap_speed(self, job, done):
        """Keep all downloads together under the speed limit set on the page (if any)."""
        with self._cond:
            last, job.limit_bytes = job.limit_bytes, done
        # Each stream counts its bytes from zero again
        wait = self._limiter.delay(done - last) if last is not None and done > last else 0.0
        while wait > 0:
            if job.cancel_event.wait(min(wait, 1.0)):
                raise DownloadCancelled("Cancelled")
            wait -= 1.0

    def _on_postprocess(self, job, d):
        if job.cancel_event.is_set():
            raise DownloadCancelled("Cancelled")
        if d.get("status") != "started":
            return
        name = d.get("postprocessor") or ""
        if name == "Merger":
            self._update(job, status="merging", stage=STAGE_NAMES[name], speed=None, eta=None)
        elif name != "MoveFiles":
            self._update(job, status="processing", stage=STAGE_NAMES.get(name, name), speed=None, eta=None)

    # --- cleanup -----------------------------------------------------------

    def _sweep_loop(self):
        while True:
            time.sleep(300)
            cutoff = time.time() - JOB_TTL_SECONDS
            with self._cond:
                expired = [
                    j.id for j in self._jobs.values()
                    if j.status in FINISHED and j.finished_at and j.finished_at < cutoff
                ]
            for job_id in expired:
                self.remove(job_id)


def _remove_dirs(paths):
    for path in paths:
        shutil.rmtree(path, ignore_errors=True)


_manager = None
_manager_lock = threading.Lock()


def get_manager() -> JobManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = JobManager()
        return _manager
