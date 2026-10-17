import os
import re
import shutil
import tempfile
import threading

import yt_dlp
from yt_dlp.utils import DownloadCancelled

# Netscape-format cookies.txt from a logged-in browser. YouTube asks servers it doesn't trust
# to "sign in to confirm you're not a bot"; cookies get past that. They can be uploaded from the
# page (saved in DATA_DIR) or mounted and pointed to with COOKIES_FILE; an upload wins.
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(tempfile.gettempdir(), "video-grabber-data")
UPLOADED_COOKIES = os.path.join(DATA_DIR, "cookies.txt")
COOKIES_FILE = os.environ.get("COOKIES_FILE", "")

MAX_COOKIES_BYTES = 1024 * 1024

_lock = threading.Lock()
_copy = {"source": None, "mtime": None, "path": None}


def cookies_source():
    """Which cookies file is in use, if any: 'upload', 'file' or None."""
    if os.path.isfile(UPLOADED_COOKIES):
        return "upload"
    if COOKIES_FILE and os.path.isfile(COOKIES_FILE):
        return "file"
    return None


def cookiefile():
    """
    Path yt-dlp should use. yt-dlp writes cookies back on exit, so it gets a private copy
    (the original can be read-only); the copy is refreshed when the original changes.
    """
    kind = cookies_source()
    if kind is None:
        return None
    source = UPLOADED_COOKIES if kind == "upload" else COOKIES_FILE
    mtime = os.path.getmtime(source)
    with _lock:
        if _copy["source"] != source or _copy["mtime"] != mtime or not _copy["path"]:
            if not _copy["path"]:
                fd, _copy["path"] = tempfile.mkstemp(prefix="cookies-", suffix=".txt")
                os.close(fd)
            shutil.copyfile(source, _copy["path"])
            _copy.update(source=source, mtime=mtime)
        return _copy["path"]


def save_uploaded_cookies(content: bytes):
    """Check that it looks like a Netscape cookies.txt and store it."""
    if len(content) > MAX_COOKIES_BYTES:
        raise ValueError("That file is too big for a cookies.txt.")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("That isn't a text file. Export cookies as a Netscape cookies.txt.")
    lines = [line for line in text.splitlines() if line.strip()]
    cookie_lines = [
        line for line in lines
        if (not line.startswith("#") or line.startswith("#HttpOnly_")) and len(line.split("\t")) >= 7
    ]
    if not cookie_lines:
        raise ValueError(
            "No cookies found. Export them in Netscape format (the cookies.txt that "
            "browser extensions like \"Get cookies.txt LOCALLY\" produce)."
        )
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = UPLOADED_COOKIES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, UPLOADED_COOKIES)
    return len(cookie_lines)


def delete_uploaded_cookies():
    try:
        os.remove(UPLOADED_COOKIES)
        return True
    except FileNotFoundError:
        return False


# YouTube wants a signed-in user for these; cookies can help
SIGN_IN_NEEDED = re.compile(
    r"confirm you.re not a bot|Sign in to confirm|age.restricted|members.only|Private video|"
    r"This video is available to this channel's members",
    re.I,
)
def _options(with_cookies: bool, extra: dict) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
    }
    if with_cookies:
        opts["cookiefile"] = cookiefile()
        # Some accounts only get SABR streams on the default web client (one 360p file);
        # web_safari still lists the HLS formats up to 1080p, so ask both and merge
        opts["extractor_args"] = {"youtube": {"player_client": ["default", "web_safari"]}}
    opts.update(extra)
    return opts


def extract(url: str, download: bool = False, **extra) -> dict:
    """
    Run yt-dlp on a link. Always anonymous first, because cookies can cut a YouTube account down
    to fewer, lower-quality streams (and the bot check comes and goes); if the site insists on a
    signed-in user and cookies are available, retry with them.
    """
    attempts = [False, True] if cookiefile() is not None else [False]

    last_error = None
    for with_cookies in attempts:
        try:
            with yt_dlp.YoutubeDL(_options(with_cookies, extra)) as ydl:
                return ydl.extract_info(url, download=download)
        except DownloadCancelled:
            raise
        except Exception as exc:
            if not SIGN_IN_NEEDED.search(str(exc)):
                raise
            last_error = exc
    raise last_error
