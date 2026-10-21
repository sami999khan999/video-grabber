import os
import threading
import time
from urllib.parse import urlparse

from yt_dlp.utils import get_compatible_ext

from common.utils.log import log

from .ytdlp import extract, mix_video_url, playing_playlist


# Lookups are reused for a while, so opening the same link again (web app, extension popup)
# doesn't send the site another round of requests
INFO_CACHE_SECONDS = float(os.environ.get("INFO_CACHE_MINUTES", "10")) * 60
MIX_LENGTH = 100
_info_cache = {}
_info_lock = threading.Lock()


def extract_video_info(url: str, headers=None, cookie_text=None) -> dict:
    """
    Extract video metadata (title, thumbnail, duration, available formats)
    without downloading the video. Playlist links return the list of entries.
    """
    if cookie_text:
        # Someone's login was used: the answer is theirs, so it isn't cached
        return _extract_video_info(url, headers, cookie_text)
    now = time.time()
    with _info_lock:
        cached = _info_cache.get(url)
        if cached and now - cached[0] < INFO_CACHE_SECONDS:
            return cached[1]
    result = _extract_video_info(url, headers)
    with _info_lock:
        # Keep the cache small: drop expired entries, then the oldest
        for key in [k for k, (t, _) in _info_cache.items() if now - t >= INFO_CACHE_SECONDS]:
            del _info_cache[key]
        if len(_info_cache) >= 200:
            del _info_cache[min(_info_cache, key=lambda k: _info_cache[k][0])]
        _info_cache[url] = (now, result)
    return result


def _extract_video_info(url: str, headers=None, cookie_text=None) -> dict:
    log("info", f"Extracting info for URL: {url}")
    # A video played inside a playlist or Mix brings the whole list, that video marked
    playing = playing_playlist(url)
    # A Mix never ends (YouTube keeps serving it, repeats and all): stop after a long playlist's worth
    mix = {"playlistend": MIX_LENGTH} if playing and "list=RD" in url else {}
    info = extract(
        url,
        headers=headers,
        cookie_text=cookie_text,
        skip_download=True,
        noplaylist=not playing,
        # Playlists are listed without resolving every entry (fast)
        extract_flat="in_playlist",
        **mix,
    )
    log("info", "yt-dlp info extracted", payload={
        "title": info.get("title"),
        "duration": info.get("duration"),
        "format_count": len(info.get("formats") or []),
        "webpage_url": url,
    })

    if info.get("_type") == "playlist" or info.get("entries") is not None:
        result = _playlist_info(info, url)
        if playing:
            result["current"] = playing
        return result

    formats = info.get("formats") or []
    duration = info.get("duration") or 0
    audio_only = [f for f in formats if _has_audio(f) and not _has_video(f)]

    # Audio track that gets merged into video downloads (AAC preferred, like the job selectors)
    m4a_audio = [f for f in audio_only if f.get("ext") == "m4a"]
    merge_audio = max(m4a_audio or audio_only, key=lambda f: f.get("abr") or 0, default=None)
    merge_audio_size = _estimate_size(merge_audio, duration) if merge_audio else 0

    # One choice per resolution. Format ids differ between YouTube clients (and a download may
    # need a different client than the lookup did), so a choice is "this height", not an id.
    by_height = {}
    for f in formats:
        if _has_video(f) and f.get("height"):
            by_height.setdefault(f["height"], []).append(f)

    videos = []
    for height, group in by_height.items():
        # Describe the file this choice will most likely produce
        picked = _likely_pick(group)
        fps = picked.get("fps") or 0
        hdr = (picked.get("dynamic_range") or "SDR") != "SDR"
        size = _estimate_size(picked, duration)
        if size and not _has_audio(picked):
            size += merge_audio_size or 0
        short_side = min(height, picked.get("width") or height)
        videos.append({
            "format_id": f"h{height}",
            "quality": f"{short_side}p",
            "note": " · ".join(filter(None, [
                {2160: "4K", 1440: "2K", 4320: "8K"}.get(short_side, ""),
                f"{int(fps)}fps" if fps >= 50 else "",
                "HDR" if hdr else "",
            ])),
            "ext": _output_ext(picked, merge_audio),
            "height": height,
            "filesize": size,
            "type": "video",
        })
    videos.sort(key=lambda v: -v["height"])

    best = None
    if videos:
        top = videos[0]
        best = {**top, "format_id": "best", "quality": "Best quality", "note": top["quality"], "height": 99999}
    elif formats:
        best = {"format_id": "best", "quality": "Best quality", "note": "", "ext": formats[-1].get("ext") or "",
                "height": 99999, "filesize": None, "type": "video"}

    audios = []
    if m4a_audio:
        top = max(m4a_audio, key=lambda f: f.get("abr") or 0)
        audios.append(_audio_choice("audio", "m4a", "AAC · original", top, duration))
    opus = [f for f in audio_only if (f.get("acodec") or "").startswith("opus")]
    if opus:
        top = max(opus, key=lambda f: f.get("abr") or 0)
        audios.append(_audio_choice("audio-opus", top.get("ext") or "webm", "Opus · original", top, duration))
    if not audios and audio_only:
        top = max(audio_only, key=lambda f: f.get("abr") or 0)
        audios.append(_audio_choice("audio", top.get("ext") or "", "original", top, duration))
    # MP3 works everywhere: converted from the best audio (or from the video's sound)
    if formats:
        audios.append({
            "format_id": "audio-mp3",
            "quality": "MP3",
            "note": "192 kbps · converted",
            "ext": "mp3",
            "height": 0,
            "filesize": int(192_000 / 8 * duration) if duration else None,
            "type": "audio",
        })

    thumbnail = info.get("thumbnail")
    if not thumbnail and info.get("thumbnails"):
        thumbnail = info.get("thumbnails")[-1].get("url")

    return {
        "kind": "video",
        "title": info.get("title", ""),
        "thumbnail": thumbnail or "",
        "duration": duration,
        "uploader": info.get("uploader", ""),
        "webpage_url": url,
        "formats": ([best] if best else []) + videos + audios,
    }


def _has_video(f: dict) -> bool:
    return (f.get("vcodec") or "none") != "none"


def _has_audio(f: dict) -> bool:
    return (f.get("acodec") or "none") != "none"


def _likely_pick(group: list) -> dict:
    """The format the job selector would most likely take at this height: H.264 first, then bitrate."""
    return max(group, key=lambda f: (
        (f.get("vcodec") or "").startswith("avc1"),
        f.get("fps") or 0,
        f.get("tbr") or 0,
    ))


def _output_ext(video: dict, audio: dict | None) -> str:
    """mp4 when the streams fit in it, mkv otherwise (the same rule yt-dlp applies when merging)."""
    if _has_audio(video) or not audio:
        return video.get("ext") or "mp4"
    return get_compatible_ext(
        vcodecs=[video.get("vcodec")],
        acodecs=[audio.get("acodec")],
        vexts=[video.get("ext")],
        aexts=[audio.get("ext")],
        preferences=("mp4", "mkv"),
    )


def _audio_choice(format_id: str, ext: str, note: str, f: dict, duration: float) -> dict:
    abr = f.get("abr")
    return {
        "format_id": format_id,
        "quality": f"{int(abr)} kbps" if abr else "Audio",
        "note": note,
        "ext": ext,
        "height": 0,
        "filesize": _estimate_size(f, duration),
        "type": "audio",
    }


def _estimate_size(f: dict, duration: float):
    """Exact size when known, otherwise bitrate (kbit/s) x duration."""
    if not f:
        return None
    size = f.get("filesize") or f.get("filesize_approx")
    if size:
        return size
    tbr = f.get("tbr")
    if tbr and duration:
        return int(tbr * 1000 / 8 * duration)
    return None


def _playlist_info(info: dict, url: str) -> dict:
    entries = []
    seen = set()
    for entry in info.get("entries") or []:
        if not entry:
            continue
        entry_url = entry.get("url") or entry.get("webpage_url")
        if not entry_url:
            continue
        # Flat YouTube entries carry the id rather than a full watch link
        if not entry_url.startswith("http") and entry.get("ie_key") == "Youtube":
            entry_url = f"https://www.youtube.com/watch?v={entry_url}"
        title = entry.get("title") or entry_url
        # Feeds list Mixes next to videos; take the video each one starts from
        mix_video = mix_video_url(entry_url)
        if mix_video:
            entry_url = mix_video
            title = title.removeprefix("Mix - ")
        # Other playlists and channels in a feed aren't one video each
        elif entry.get("ie_key") == "YoutubeTab":
            continue
        # Mixes and feeds repeat videos
        if entry_url in seen:
            continue
        seen.add(entry_url)
        thumbnails = entry.get("thumbnails") or []
        entries.append({
            "id": entry.get("id") or entry_url,
            "url": entry_url,
            "title": title,
            "duration": entry.get("duration") or 0,
            "thumbnail": entry.get("thumbnail")
            or (thumbnails[-1].get("url") if thumbnails else ""),
            "uploader": entry.get("uploader") or entry.get("channel") or "",
        })

    if not entries:
        host = (urlparse(url).hostname or "").lower()
        if host == "youtube.com" or host.endswith(".youtube.com"):
            raise ValueError(
                "Nothing to grab here. YouTube shows your history, feeds and private playlists "
                "only to a signed-in user, and the server has no working YouTube login. Be logged "
                "in to YouTube in the browser with the extension (it sends the login by itself), "
                "or upload a cookies.txt in the Cookies tab, then try again."
            )
        raise ValueError("This playlist is empty.")

    thumbnails = info.get("thumbnails") or []
    thumbnail = info.get("thumbnail") or (thumbnails[-1].get("url") if thumbnails else "")
    if not thumbnail and entries:
        thumbnail = entries[0]["thumbnail"]

    return {
        "kind": "playlist",
        "title": info.get("title") or "Playlist",
        "thumbnail": thumbnail,
        "uploader": info.get("uploader") or info.get("channel") or "",
        "webpage_url": url,
        "entries": entries,
    }
