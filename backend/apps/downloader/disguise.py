from yt_dlp.downloader.fragment import FragmentFD

# Some streaming hosts serve each HLS piece as a fake image: a tiny PNG (or JPEG/GIF) glued in
# front of the real MPEG-TS data, so the pieces look like pictures to filters. Left in, ffmpeg
# reads the joined file as an image and never turns it into a video.
IMAGE_SIGNATURES = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a")
TS_SYNC = 0x47
TS_PACKET = 188
# The fake image is small; the video starts well within this many bytes
SEARCH_LIMIT = 64 * 1024


def strip_image_header(content: bytes) -> bytes:
    """Drop a fake image in front of an MPEG-TS piece; anything else is returned unchanged."""
    if not content or content[0] == TS_SYNC or not content.startswith(IMAGE_SIGNATURES):
        return content
    for offset in range(1, min(len(content), SEARCH_LIMIT)):
        # A real TS start has sync bytes repeating every packet, not just one stray 0x47
        if all(
            content[at] == TS_SYNC
            for at in range(offset, min(offset + 3 * TS_PACKET + 1, len(content)), TS_PACKET)
        ) and offset + TS_PACKET < len(content):
            return content[offset:]
    return content


_append_fragment = FragmentFD._append_fragment


def _append_unmasked(self, ctx, frag_content):
    return _append_fragment(self, ctx, strip_image_header(frag_content))


FragmentFD._append_fragment = _append_unmasked
