import json
import os
import time

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.http import FileResponse, Http404, StreamingHttpResponse
from django.views.decorators.http import require_GET

from .jobs import FINISHED, MAX_PARALLEL_DOWNLOADS, clean_error, get_manager
from .politeness import PER_SITE_PARALLEL, POLITE_MODE
from .services import extract_video_info
from .ytdlp import (
    clean_headers,
    cookies_detail,
    cookies_source,
    delete_uploaded_cookies,
    parse_cookie_text,
    save_uploaded_cookies,
)


def request_cookies(data):
    """A login sent with one request (Netscape cookies.txt text), checked; None when absent."""
    raw = data.get("cookies")
    if not raw:
        return None
    if not isinstance(raw, str):
        raise ValueError("cookies must be the text of a cookies.txt file.")
    text, _ = parse_cookie_text(raw.encode("utf-8"))
    return text


class StatusView(APIView):
    """GET /api/status/ -> how the downloader is configured."""

    def get(self, request):
        return Response({
            "max_parallel": MAX_PARALLEL_DOWNLOADS,
            "polite": POLITE_MODE,
            # 0 means no limit
            "per_site_parallel": PER_SITE_PARALLEL if POLITE_MODE else None,
            # "upload" (added from the page or the extension), "file" (COOKIES_FILE) or null
            "cookies": cookies_source(),
            # For uploaded cookies: { origin: "file" | "extension", updated_at, count }
            "cookies_detail": cookies_detail(),
        })


class CookiesView(APIView):
    """
    POST   /api/cookies/  -> store a Netscape cookies.txt (multipart "file", or JSON "content";
                             "origin": "extension" when the browser extension syncs a login)
    DELETE /api/cookies/  -> forget the uploaded cookies
    """

    def post(self, request):
        upload = request.FILES.get("file")
        if upload:
            content = upload.read()
        else:
            content = (request.data.get("content") or "").encode("utf-8")
        if not content:
            return Response({"error": "Send a cookies.txt file."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            count = save_uploaded_cookies(content, origin=request.data.get("origin") or "file")
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"cookies": cookies_source(), "count": count, "cookies_detail": cookies_detail()},
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        delete_uploaded_cookies()
        return Response({"cookies": cookies_source()})


class VideoInfoView(APIView):
    """
    POST /api/info/
    Body: { "url": "https://...", "start"?: 101 }
    Returns video metadata (title, thumbnail, duration, formats),
    or for a playlist link its title and entries. Endless lists (Mixes, YouTube feeds) come
    100 at a time: "next_start" is where the next page begins (null at the end).
    """

    def post(self, request):
        url = request.data.get("url")
        if not url:
            return Response(
                {"error": "URL is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            # The browser extension may pass the page's headers and (if the user allows it)
            # their login for that site
            cookie_text = request_cookies(request.data)
            try:
                start = max(1, int(request.data.get("start") or 1))
            except (TypeError, ValueError):
                start = 1
            info = extract_video_info(url, headers=clean_headers(request.data.get("headers")), cookie_text=cookie_text, start=start)
            return Response(info, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": clean_error(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class JobListView(APIView):
    """
    GET  /api/jobs/  -> all jobs
    POST /api/jobs/  -> queue downloads
    Body: { "items": [{ "url", "format_id", "label"?, "title"?, "thumbnail"?, "group"? }] }
    """

    def get(self, request):
        _, jobs = get_manager().snapshot()
        return Response({"jobs": jobs})

    def post(self, request):
        items = request.data.get("items")
        if not isinstance(items, list) or not items:
            return Response(
                {"error": "items must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for item in items:
            if not isinstance(item, dict) or not item.get("url"):
                return Response(
                    {"error": "Every item needs a url."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                item["cookies"] = request_cookies(item)
            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        jobs = get_manager().create(items)
        return Response(
            {"jobs": [job.to_dict() for job in jobs]},
            status=status.HTTP_201_CREATED,
        )


class JobDetailView(APIView):
    """DELETE /api/jobs/<id>/ -> cancel the job if it runs, and remove it."""

    def delete(self, request, job_id):
        if not get_manager().remove(job_id):
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class JobCancelView(APIView):
    """POST /api/jobs/<id>/cancel/ -> stop the job but keep it in the list."""

    def post(self, request, job_id):
        job = get_manager().cancel(job_id)
        if not job:
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(job.to_dict())


class JobPauseView(APIView):
    """
    POST /api/jobs/<id>/pause/  -> stop downloading but keep the partial file
    POST /api/jobs/<id>/resume/ -> continue where it stopped
    """

    action = "pause"

    def post(self, request, job_id):
        manager = get_manager()
        job = manager.pause(job_id) if self.action == "pause" else manager.resume(job_id)
        if not job:
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(job.to_dict())


class JobPriorityView(APIView):
    """
    POST /api/jobs/<id>/priority/ -> make this the download that goes first and fastest
    (the others slow down meanwhile). With {"on": false} it goes back to normal.
    """

    def post(self, request, job_id):
        job = get_manager().prioritize(job_id, on=request.data.get("on", True) is not False)
        if not job:
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(job.to_dict())


class JobRetryView(APIView):
    """POST /api/jobs/<id>/retry/ -> replace a failed or cancelled job with a fresh one."""

    def post(self, request, job_id):
        manager = get_manager()
        job = manager.get(job_id)
        if not job:
            return Response({"error": "Job not found."}, status=status.HTTP_404_NOT_FOUND)
        if job.status not in FINISHED:
            return Response(
                {"error": "Job is still running."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(manager.retry(job_id).to_dict(), status=status.HTTP_201_CREATED)


class JobClearView(APIView):
    """
    POST /api/jobs/clear/ -> remove every finished, failed or cancelled job.
    With {"all": true} running and queued jobs are stopped and removed too.
    """

    def post(self, request):
        everything = request.data.get("all") is True
        return Response({"removed": get_manager().clear(everything)})


@require_GET
def job_file(request, job_id):
    """GET /api/jobs/<id>/file/ -> the downloaded file as an attachment."""
    job = get_manager().get(job_id)
    if not job or job.status != "done" or not job.filepath or not os.path.exists(job.filepath):
        raise Http404("File not available.")
    return FileResponse(
        open(job.filepath, "rb"),
        as_attachment=True,
        filename=job.filename,
        content_type="application/octet-stream",
    )


@require_GET
def job_stream(request):
    """
    GET /api/jobs/stream/ -> Server-Sent Events with the full job list
    whenever it changes (at most ~4 times a second), plus a keep-alive ping.
    """
    manager = get_manager()

    def events():
        version = -1
        yield "retry: 2000\n\n"
        while True:
            new_version, jobs = manager.wait_for_change(version, timeout=15)
            if new_version == version:
                yield ": ping\n\n"
                continue
            version = new_version
            yield f"data: {json.dumps({'jobs': jobs})}\n\n"
            time.sleep(0.25)

    response = StreamingHttpResponse(events(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
