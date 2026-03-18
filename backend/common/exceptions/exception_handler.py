from django.utils.timezone import now
from rest_framework.response import Response

from common.utils.log import log
from .app_errors import AppError, get_custom_error
from .exception_data import ExceptionDataParser


def custom_exception_handler(exc, context):
    request = context.get("request")
    path = request.path if request else None
    method = request.method if request else None
    timestamp = now().isoformat()
    view = context.get("view")
    view_name = view.__class__.__name__ if view else None

    ErrorClass = exc.__class__ if isinstance(exc, AppError) else get_custom_error(exc)

    parser = ExceptionDataParser(exc, ErrorClass)
    error_json = parser.parse()

    err = ErrorClass(
        details=error_json.get("details"),
        fields=error_json.get("fields"),
        status_code=error_json.get("status_code"),
        code=error_json.get("code"),
    )

    error_json = err.to_dict(path, timestamp, method, view_name)

    return Response(error_json, status=error_json.get("status_code"))
