import ipaddress
import os
import random
import threading
import time
from contextlib import contextmanager
from urllib.parse import urlparse

from yt_dlp.utils import DownloadCancelled

# Polite mode keeps traffic to any one site looking like a person, not a burst from a bot:
# few downloads per site at once, a random pause between starting them, a pause between
# yt-dlp's own requests. Sites block on bursts, so this is what keeps the IP (and cookies) clean.
POLITE_MODE = os.environ.get("POLITE_MODE", "1") != "0"
PER_SITE_PARALLEL = max(1, int(os.environ.get("PER_SITE_PARALLEL", "2")))
START_GAP = (
    float(os.environ.get("START_GAP_MIN", "3")),
    float(os.environ.get("START_GAP_MAX", "8")),
)
# Seconds yt-dlp waits between the requests it makes while resolving one video
REQUEST_SLEEP = float(os.environ.get("REQUEST_SLEEP", "1"))

# Different hostnames of the same service share one budget
_ALIASES = {"youtu.be": "youtube.com", "youtube-nocookie.com": "youtube.com", "googlevideo.com": "youtube.com"}


def site_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    parts = host.split(".")
    site = ".".join(parts[-2:]) if len(parts) >= 2 else host
    return _ALIASES.get(site, site)


class SiteGate:
    def __init__(self):
        self._lock = threading.Lock()
        self._slots = {}
        self._next_start = {}

    def _semaphore(self, site):
        with self._lock:
            return self._slots.setdefault(site, threading.BoundedSemaphore(PER_SITE_PARALLEL))

    @contextmanager
    def slot(self, url, cancel_event, on_wait=None):
        """Hold one of the site's download slots, starting no sooner than its spacing allows."""
        if not POLITE_MODE:
            yield
            return

        site = site_of(url)
        semaphore = self._semaphore(site)
        waited = False
        while not semaphore.acquire(timeout=0.5):
            if cancel_event.is_set():
                raise DownloadCancelled("Cancelled")
            if not waited and on_wait:
                on_wait(f"Waiting for a free {site} slot")
                waited = True
        try:
            # Book a start time a few random seconds after the previous start on this site
            with self._lock:
                now = time.time()
                start = max(now, self._next_start.get(site, 0.0))
                self._next_start[site] = start + random.uniform(*START_GAP)
            if start > now and on_wait:
                on_wait("Pacing requests")
            while time.time() < start:
                if cancel_event.wait(min(0.5, start - time.time())):
                    raise DownloadCancelled("Cancelled")
            yield
        finally:
            semaphore.release()


gate = SiteGate()


def polite_options() -> dict:
    """yt-dlp options that slow its own request rate down a little."""
    if not POLITE_MODE:
        return {}
    return {"sleep_interval_requests": REQUEST_SLEEP}


def retry_pause(cancel_event):
    """Wait a while before retrying a refused stream, so the retry isn't another burst."""
    pause = random.uniform(8, 20) if POLITE_MODE else 1
    if cancel_event.wait(pause):
        raise DownloadCancelled("Cancelled")
