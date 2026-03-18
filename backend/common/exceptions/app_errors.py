from rest_framework import status
from rest_framework.exceptions import (
    ValidationError,
    NotFound,
    PermissionDenied,
    AuthenticationFailed,
    Throttled,
)
from django.db import IntegrityError, OperationalError

from common.utils.log import log


class AppError(Exception):
    default_status_code = status.HTTP_400_BAD_REQUEST
    default_details = "Something went wrong!"
    default_code = "error"
    log_level = "error"

    def __init__(self, details=None, status_code=None, fields=None, code=None):
        self.status_code = status_code or self.default_status_code
        self.details = details or self.default_details
        self.fields = fields or None
        self.code = code or self.default_code
        super().__init__(self.details)

    def to_dict(self, path=None, timestamp=None, method=None, view_name=None):
        error_data = {
            "ok": False,
            "error": {
                "status_code": self.status_code,
                "code": self.code,
                "details": self.details,
                "fields": self.fields,
            },
            "context": {
                "path": path,
                "timestamp": timestamp,
                "method": method,
                "handler": view_name,
            },
        }

        log_data = {
            "ok": False,
            "status_code": self.status_code,
            "code": self.code,
            "fields": self.fields,
            "details": self.details,
            "type": "response",
            "context": error_data["context"],
        }

        log(level=self.log_level, payload=log_data)

        return error_data


class InternalServerError(AppError):
    default_status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    default_details = "Internal server error!"
    default_code = "internal_server_error"
    log_level = "error"


class BadGatewayError(AppError):
    default_status_code = status.HTTP_502_BAD_GATEWAY
    default_details = "Bad gateway!"
    default_code = "bad_gateway"
    log_level = "error"


class GatewayTimeoutError(AppError):
    default_status_code = status.HTTP_504_GATEWAY_TIMEOUT
    default_details = "Gateway timeout!"
    default_code = "gateway_timeout"
    log_level = "error"


class ServiceUnavailableError(AppError):
    default_status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_details = "Service unavailable, try again later!"
    default_code = "service_unavailable"
    log_level = "error"


class ConflictError(AppError):
    default_status_code = status.HTTP_409_CONFLICT
    default_details = "Conflict occurred!"
    default_code = "conflict"
    log_level = "error"


class ValidationAppError(AppError):
    default_status_code = status.HTTP_400_BAD_REQUEST
    default_details = "Validation error!"
    default_code = "validation_error"
    log_level = "warning"


class NotFoundError(AppError):
    default_status_code = status.HTTP_404_NOT_FOUND
    default_details = "Resource not found!"
    default_code = "not_found"
    log_level = "warning"


class PermissionDeniedError(AppError):
    default_status_code = status.HTTP_403_FORBIDDEN
    default_details = "Permission denied!"
    default_code = "permission_denied"
    log_level = "warning"


class AuthenticationError(AppError):
    default_status_code = status.HTTP_401_UNAUTHORIZED
    default_details = "Authentication failed!"
    default_code = "authentication_failed"
    log_level = "warning"


class TooManyRequestsError(AppError):
    default_status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_details = "Too many requests!"
    default_code = "too_many_requests"
    log_level = "warning"


class ForbiddenError(AppError):
    default_status_code = status.HTTP_403_FORBIDDEN
    default_details = "Forbidden!"
    default_code = "forbidden"
    log_level = "warning"


class FeatureDisabledError(AppError):
    default_status_code = status.HTTP_501_NOT_IMPLEMENTED
    default_details = "Feature not implemented!"
    default_code = "feature_disabled"
    log_level = "warning"


class PayloadTooLargeError(AppError):
    default_status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_details = "Payload too large!"
    default_code = "payload_too_large"
    log_level = "warning"


class UnsupportedMediaTypeError(AppError):
    default_status_code = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE
    default_details = "Unsupported media type!"
    default_code = "unsupported_media_type"
    log_level = "warning"


class UnprocessableEntityError(AppError):
    default_status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_details = "Unprocessable entity!"
    default_code = "unprocessable_entity"
    log_level = "warning"


EXCEPTION_MAPPING = {
    ValidationError: ValidationAppError,
    NotFound: NotFoundError,
    PermissionDenied: PermissionDeniedError,
    AuthenticationFailed: AuthenticationError,
    Throttled: TooManyRequestsError,
    ValueError: ValidationAppError,
    TypeError: ValidationAppError,
    NotImplementedError: FeatureDisabledError,
    AssertionError: ValidationAppError,
    AttributeError: InternalServerError,
    KeyError: ValidationAppError,
    ConflictError: ConflictError,
    ServiceUnavailableError: ServiceUnavailableError,
    IntegrityError: ConflictError,
    OperationalError: ServiceUnavailableError,
    IndexError: InternalServerError,
    ImportError: InternalServerError,
    ModuleNotFoundError: InternalServerError,
}


def get_custom_error(exc):
    for exc_type, err_class in EXCEPTION_MAPPING.items():
        if isinstance(exc, exc_type):
            return err_class
    return InternalServerError
