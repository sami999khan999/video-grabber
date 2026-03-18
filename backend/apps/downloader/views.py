import os
import shutil

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.http import FileResponse

from .services import extract_video_info, download_video


class VideoInfoView(APIView):
    """
    POST /api/info/
    Body: { "url": "https://..." }
    Returns video metadata: title, thumbnail, duration, available formats.
    """

    def post(self, request):
        url = request.data.get("url")
        if not url:
            return Response(
                {"error": "URL is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            info = extract_video_info(url)
            return Response(info, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )


class VideoDownloadView(APIView):
    """
    POST /api/download/
    Body: { "url": "https://...", "format_id": "best" }
    Downloads the video and streams the file back to the client.
    """

    def post(self, request):
        url = request.data.get("url")
        format_id = request.data.get("format_id", "best")

        if not url:
            return Response(
                {"error": "URL is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filepath = None
        tmp_dir = None

        try:
            result = download_video(url, format_id)
            filepath = result["filepath"]
            tmp_dir = os.path.dirname(filepath)
            
            # Sanitize filename for Content-Disposition
            safe_title = "".join([c for c in result["title"] if c.isalnum() or c in " .-_"]).strip()
            filename = f"{safe_title}.{result['ext']}"

            response = FileResponse(
                open(filepath, "rb"),
                content_type="application/octet-stream",
            )
            response["Content-Disposition"] = (
                f'attachment; filename="{filename}"'
            )

            # Clean up temp directory after response is sent
            original_close = response.close

            def cleanup_close():
                original_close()
                try:
                    if tmp_dir and os.path.exists(tmp_dir):
                        shutil.rmtree(tmp_dir)
                except Exception:
                    pass

            response.close = cleanup_close

            return response

        except Exception as e:
            # Clean up on error
            if tmp_dir and os.path.exists(tmp_dir):
                shutil.rmtree(tmp_dir)
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
