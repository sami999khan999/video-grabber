import os
import tempfile
import yt_dlp
from common.utils.log import log


def extract_video_info(url: str) -> dict:
    """
    Extract video metadata (title, thumbnail, duration, available formats)
    without downloading the video.
    """
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        log("info", f"Extracting info for URL: {url}")
        info = ydl.extract_info(url, download=False)
        # Log only a summary of info to prevent logger crashes
        log_summary = {
            "title": info.get("title"),
            "duration": info.get("duration"),
            "format_count": len(info.get("formats", [])),
            "webpage_url": url,
        }
        log("info", "yt-dlp info extracted", payload=log_summary)

    formats = []
    seen = set()

    for f in info.get("formats", []):
        ext = f.get("ext", "")
        height = f.get("height")
        format_id = f.get("format_id", "")
        filesize = f.get("filesize") or f.get("filesize_approx")

        # Only include formats that have both video and audio, or are audio-only
        has_video = f.get("vcodec", "none") != "none"
        has_audio = f.get("acodec", "none") != "none"

        if has_video and has_audio:
            label = f"{height}p" if height else ext
            key = f"{label}-{ext}"
            if key not in seen:
                seen.add(key)
                formats.append({
                    "format_id": format_id,
                    "ext": ext,
                    "quality": label,
                    "height": height or 0,
                    "filesize": filesize,
                    "type": "video",
                })
        elif has_audio and not has_video:
            abr = f.get("abr")
            label = f"{int(abr)}kbps" if abr else "audio"
            key = f"audio-{label}-{ext}"
            if key not in seen:
                seen.add(key)
                formats.append({
                    "format_id": format_id,
                    "ext": ext,
                    "quality": label,
                    "height": 0,
                    "filesize": filesize,
                    "type": "audio",
                })

    # Sort: videos by height descending, then audio
    formats.sort(key=lambda x: (x["type"] == "audio", -x["height"]))

    # Also offer "best" merged option
    best_option = {
        "format_id": "best",
        "ext": "mp4",
        "quality": "Best Quality",
        "height": 9999,
        "filesize": None,
        "type": "video",
    }

    # Get the best thumbnail URL
    thumbnail = info.get("thumbnail")
    if not thumbnail and info.get("thumbnails"):
        thumbnail = info.get("thumbnails")[-1].get("url")

    return {
        "title": info.get("title", ""),
        "thumbnail": thumbnail or "",
        "duration": info.get("duration", 0) or 0,
        "uploader": info.get("uploader", ""),
        "webpage_url": url,
        "formats": [best_option] + formats,
    }


def download_video(url: str, format_id: str = "best") -> dict:
    """
    Download a video to a temporary file and return the file path + metadata.
    The caller is responsible for deleting the temp file after streaming.
    """
    tmp_dir = tempfile.mkdtemp()

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "outtmpl": os.path.join(tmp_dir, "%(title)s.%(ext)s"),
    }

    if format_id and format_id != "best":
        ydl_opts["format"] = format_id
    else:
        # Best single file if FFmpeg might be missing
        ydl_opts["format"] = "best[ext=mp4]/best"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        log("info", f"Downloading video from URL: {url} with format_id: {format_id}")
        info = ydl.extract_info(url, download=True)
        filename = ydl.prepare_filename(info)

        # If merged, the extension might change
        if ydl_opts.get("merge_output_format"):
            base, _ = os.path.splitext(filename)
            merged = base + "." + ydl_opts["merge_output_format"]
            if os.path.exists(merged):
                filename = merged

    return {
        "filepath": filename,
        "title": info.get("title", "video"),
        "ext": os.path.splitext(filename)[1].lstrip("."),
    }
