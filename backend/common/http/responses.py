from django.conf import settings
from rest_framework import status as http_status
from rest_framework.response import Response
from django.utils import timezone

from apps.auth.services.token.jwt_access_token import AccessTokenService
from apps.auth.services.token.jwt_refresh_token import RefreshTokenService
from common.exceptions.app_errors import ValidationAppError
from common.utils.log import log


class AppResponse:
    default_status_code = http_status.HTTP_200_OK
    default_details = "Request processed successfully"
    default_code = "success"

    def __init__(
        self,
        details=None,
        status_code=None,
        code=None,
        payload=None,
        request=None,
    ):
        self.status_code = status_code or self.default_status_code
        self.details = details or self.default_details
        self.code = code or self.default_code
        self.payload = payload
        self.request = request

        self._response = Response()

    def to_dict(self):
        context = {}
        if self.request:
            context = {
                "timestamp": timezone.now(),
                "url": self.request.path,
                "method": self.request.method,
                "handler": self.request.resolver_match.func.__name__,
            }

        response_data = {
            "ok": True,
            "data": {
                "code": self.code,
                "status_code": self.status_code,
                "details": self.details,
                "payload": self.payload,
            },
            "context": context,
        }

        log_data = {
            "ok": True,
            "code": self.code,
            "status_code": self.status_code,
            "details": self.details,
            "type": "response",
            "context": response_data["context"],
        }

        log(level="info", payload=log_data)

        return response_data

    def set_access_cookie(self, access_token=None):
        self._response.set_cookie(
            "access_token",
            access_token,
            httponly=settings.SESSION_COOKIE_HTTPONLY,
            samesite=settings.SESSION_COOKIE_SAMESITE,
            secure=settings.SESSION_COOKIE_SECURE,
            max_age=settings.JWT_ACCESS_EXPIRE,
        )

        return self

    def set_refresh_cookie(self, refresh_token=None):
        self._response.set_cookie(
            "refresh_token",
            refresh_token,
            httponly=settings.SESSION_COOKIE_HTTPONLY,
            samesite=settings.SESSION_COOKIE_SAMESITE,
            secure=settings.SESSION_COOKIE_SECURE,
            max_age=settings.JWT_REFRESH_EXPIRE,
        )

        return self

    def to_response(self):
        self._response.data = self.to_dict()
        self._response.status_code = self.status_code
        return self._response


class CreatedResponse(AppResponse):
    default_status_code = http_status.HTTP_201_CREATED
    default_details = "Resource created successfully"
    default_code = "created"


class AcceptedResponse(AppResponse):
    default_status_code = http_status.HTTP_202_ACCEPTED
    default_details = "Request accepted for processing"
    default_code = "accepted"


class NoContentResponse(AppResponse):
    default_status_code = http_status.HTTP_204_NO_CONTENT
    default_details = "No content to return"
    default_code = "no_content"
