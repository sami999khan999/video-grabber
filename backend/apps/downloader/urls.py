from django.urls import path

from .views import (
    CookiesView,
    JobCancelView,
    JobClearView,
    JobDetailView,
    JobListView,
    JobPriorityView,
    JobRetryView,
    StatusView,
    VideoInfoView,
    job_file,
    job_stream,
)

urlpatterns = [
    path("status/", StatusView.as_view(), name="status"),
    path("cookies/", CookiesView.as_view(), name="cookies"),
    path("info/", VideoInfoView.as_view(), name="video-info"),
    path("jobs/", JobListView.as_view(), name="job-list"),
    path("jobs/stream/", job_stream, name="job-stream"),
    path("jobs/clear/", JobClearView.as_view(), name="job-clear"),
    path("jobs/<str:job_id>/", JobDetailView.as_view(), name="job-detail"),
    path("jobs/<str:job_id>/cancel/", JobCancelView.as_view(), name="job-cancel"),
    path("jobs/<str:job_id>/priority/", JobPriorityView.as_view(), name="job-priority"),
    path("jobs/<str:job_id>/retry/", JobRetryView.as_view(), name="job-retry"),
    path("jobs/<str:job_id>/file/", job_file, name="job-file"),
]
