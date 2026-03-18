from django.urls import path

from .views import VideoInfoView, VideoDownloadView

urlpatterns = [
    path("info/", VideoInfoView.as_view(), name="video-info"),
    path("download/", VideoDownloadView.as_view(), name="video-download"),
]
