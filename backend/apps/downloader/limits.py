import json
import os
import threading
import time

from .ytdlp import DATA_DIR

# The most all downloads together may pull, in KB/s; 0 means no limit. Set from the page or the
# extension and kept in DATA_DIR, so it survives a restart; SPEED_LIMIT_KBPS is the starting value
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
DEFAULT_SPEED_LIMIT = max(0, int(float(os.environ.get("SPEED_LIMIT_KBPS", "0"))))
# A limited download may run this far ahead before it has to wait, so it doesn't stutter
BURST_SECONDS = 0.5

_lock = threading.Lock()
_state = {"speed_limit_kbps": None}


def speed_limit():
    """The total speed limit in KB/s (0 when there is none)."""
    with _lock:
        if _state["speed_limit_kbps"] is None:
            try:
                with open(SETTINGS_FILE, encoding="utf-8") as f:
                    _state["speed_limit_kbps"] = max(0, int(json.load(f)["speed_limit_kbps"]))
            except (OSError, ValueError, KeyError, TypeError):
                _state["speed_limit_kbps"] = DEFAULT_SPEED_LIMIT
        return _state["speed_limit_kbps"]


def set_speed_limit(kbps):
    kbps = int(kbps)
    if kbps < 0:
        raise ValueError("The speed limit can't be negative.")
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = SETTINGS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"speed_limit_kbps": kbps}, f)
        os.replace(tmp, SETTINGS_FILE)
        _state["speed_limit_kbps"] = kbps
    return kbps


class SpeedLimiter:
    """
    One budget shared by every download: each new chunk books its share of the time the limit
    allows, and the download that booked past now waits. Called from yt-dlp's progress hooks.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # When the bytes booked so far are used up at the limit
        self._due = 0.0

    def delay(self, nbytes):
        """Seconds the caller should wait after receiving `nbytes`."""
        kbps = speed_limit()
        if kbps <= 0 or nbytes <= 0:
            return 0.0
        with self._lock:
            now = time.monotonic()
            self._due = max(self._due, now - BURST_SECONDS) + nbytes / (kbps * 1024)
            return max(0.0, self._due - now)
