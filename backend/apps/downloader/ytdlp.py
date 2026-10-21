import json
import os
import re
import shutil
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlparse

import yt_dlp
from yt_dlp.utils import DownloadCancelled

from . import disguise  # noqa: F401  (unmasks HLS pieces dressed up as images)

# Netscape-format cookies.txt from a logged-in browser. YouTube asks servers it doesn't trust
# to "sign in to confirm you're not a bot"; cookies get past that. They can be uploaded from the
# page (saved in DATA_DIR) or mounted and pointed to with COOKIES_FILE; an upload wins.
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(tempfile.gettempdir(), "video-grabber-data")
UPLOADED_COOKIES = os.path.join(DATA_DIR, "cookies.txt")
# Where the stored cookies came from ("file" upload or the browser "extension"), when, how many
UPLOADED_COOKIES_META = os.path.join(DATA_DIR, "cookies.json")
COOKIE_ORIGINS = {"file", "extension"}
COOKIES_FILE = os.environ.get("COOKIES_FILE", "")
# Docker networks usually have no IPv6 route; a site that answers DNS with an IPv6 address
# then fails with "Network is unreachable". 0 lets yt-dlp try IPv6 too
FORCE_IPV4 = os.environ.get("FORCE_IPV4", "1") != "0"

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


def parse_cookie_text(content: bytes):
    """Check that it looks like a Netscape cookies.txt; returns (text, cookie count)."""
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
    return text, len(cookie_lines)


def save_uploaded_cookies(content: bytes, origin: str = "file"):
    """Check that it looks like a Netscape cookies.txt and store it (uploaded, or synced by the extension)."""
    text, count = parse_cookie_text(content)
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = UPLOADED_COOKIES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, UPLOADED_COOKIES)
    with open(UPLOADED_COOKIES_META, "w", encoding="utf-8") as f:
        json.dump({
            "origin": origin if origin in COOKIE_ORIGINS else "file",
            "updated_at": time.time(),
            "count": count,
        }, f)
    return count


def cookies_detail():
    """Where the uploaded cookies came from and when; None when there are none."""
    if not os.path.isfile(UPLOADED_COOKIES):
        return None
    try:
        with open(UPLOADED_COOKIES_META, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        # Uploaded before this was recorded
        return {"origin": "file", "updated_at": os.path.getmtime(UPLOADED_COOKIES), "count": None}


def delete_uploaded_cookies():
    removed = False
    for path in (UPLOADED_COOKIES, UPLOADED_COOKIES_META):
        try:
            os.remove(path)
            removed = True
        except FileNotFoundError:
            pass
    return removed


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
    if FORCE_IPV4:
        opts["source_address"] = "0.0.0.0"
    if with_cookies:
        opts["cookiefile"] = cookiefile()
        # Some accounts only get SABR streams on the default web client (one 360p file);
        # web_safari still lists the HLS formats up to 1080p, so ask both and merge
        opts["extractor_args"] = {"youtube": {"player_client": ["default", "web_safari"]}}
    opts.update(extra)
    return opts


# A YouTube Mix is a playlist named after the video it starts from: RD<id>, RDMM<id>, RDAMVM<id>
_MIX = re.compile(r"RD(?:MM|AMVM|EM)?([A-Za-z0-9_-]{11})")


def mix_video_url(url: str):
    """
    The video a YouTube Mix link starts from, or None. A Mix can't be opened as a playlist
    ("This playlist type is unviewable"), but the home page and other feeds list them next
    to videos, and the video it is named after is what the user saw.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if not (host == "youtube.com" or host.endswith(".youtube.com")) or "v" in parse_qs(parsed.query):
        return None
    match = _MIX.fullmatch((parse_qs(parsed.query).get("list") or [""])[0])
    return f"https://www.youtube.com/watch?v={match.group(1)}" if match else None


def playing_playlist(url: str):
    """
    The video id of a YouTube watch link played inside a real playlist (…?v=ID&list=PL…), or
    None. Mixes don't count: they are endless and made up on the spot.
    """
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    query = parse_qs(parsed.query)
    playlist = (query.get("list") or [""])[0]
    if not (host == "youtube.com" or host.endswith(".youtube.com")) or not playlist or playlist.startswith("RD"):
        return None
    return (query.get("v") or [None])[0]


# Headers the browser extension may pass on: many sites only serve a video to requests that
# look like they come from the page playing it
ALLOWED_HEADERS = {"referer": "Referer", "origin": "Origin", "user-agent": "User-Agent"}


def clean_headers(raw) -> dict:
    """Keep only the allowed headers, as single-line strings of sane length."""
    if not isinstance(raw, dict):
        return {}
    headers = {}
    for key, value in raw.items():
        name = ALLOWED_HEADERS.get(str(key).lower())
        if name and isinstance(value, str) and value and len(value) <= 2000 and not any(c in value for c in "\r\n"):
            headers[name] = value
    return headers


def extract(url: str, download: bool = False, headers=None, cookie_text=None, **extra) -> dict:
    """
    Run yt-dlp on a link. Always anonymous first, because cookies can cut a YouTube account down
    to fewer, lower-quality streams (and the bot check comes and goes); if the site insists on a
    signed-in user and cookies are available, retry with them.

    `headers` (Referer, ...) go with every request. `cookie_text` is a login the browser
    extension sent for this one request: it is used straight away, written to a private
    temporary file only for the duration of the call, and never stored.
    """
    if headers:
        extra["http_headers"] = headers
    if cookie_text:
        fd, path = tempfile.mkstemp(prefix="request-cookies-", suffix=".txt")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(cookie_text)
            with yt_dlp.YoutubeDL({**_options(False, extra), "cookiefile": path}) as ydl:
                return ydl.extract_info(url, download=download)
        finally:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    attempts = [False, True] if cookiefile() is not None else [False]

    last_error = None
    for with_cookies in attempts:
        try:
            with yt_dlp.YoutubeDL(_options(with_cookies, extra)) as ydl:
                info = ydl.extract_info(url, download=download)
            # YouTube's history, feeds and private playlists come back empty, not refused,
            # to a visitor who isn't signed in
            if not with_cookies and len(attempts) > 1 and info.get("_type") == "playlist" and not info.get("entries"):
                continue
            return info
        except DownloadCancelled:
            raise
        except Exception as exc:
            if not SIGN_IN_NEEDED.search(str(exc)):
                raise
            last_error = exc
    raise last_error
