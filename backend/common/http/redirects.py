from urllib.parse import urlencode
from django.http import HttpResponseRedirect
from django.utils import timezone

from common.utils.log import log
from common.exceptions.exception_data import ExceptionDataParser
from common.exceptions.app_errors import get_custom_error


class AppRedirect:
    def __init__(
        self,
        exc=None,
        base_url=None,
        log_level="warning",
        code=None,
        details=None,
        payload=None,
    ):
        self.exc = exc
        self.base_url = base_url.rstrip("/")
        self.details = details
        self.code = code
        self.path = ""
        self.payload = payload or {}
        self.log_level = log_level
        self.params = {}

    def error(self, path: str = "error"):
        self.path = path
        if self.exc:
            ErrorClass = get_custom_error(self.exc)
            parser = ExceptionDataParser(self.exc, ErrorClass)
            error_json = parser.parse()

            self.params = {
                "details": error_json.get("details", self.details or "Request failed"),
                "code": error_json.get("code", ""),
                "status_code": error_json.get("status_code", ""),
                "timestamp": timezone.now().isoformat(),
            }
        else:
            self.params = {
                "details": self.details or "Request failed",
                "timestamp": timezone.now().isoformat(),
                "code": self.code or "error",
            }

        log_data = {
            "ok": False,
            **self.params,
            "type": "redirect",
        }

        log(self.log_level, payload=log_data)

        for k, v in self.payload.items():
            self.params[k] = str(v)

        return self

    def success(self, path: str = "/"):
        self.path = path
        self.params = {
            "details": self.details or "Request processed successfully",
            "code": self.code or "success",
            "timestamp": timezone.now().isoformat(),
        }

        log_data = {
            "ok": True,
            **self.params,
            "type": "redirect",
        }

        log(self.log_level, payload=log_data)

        for k, v in self.payload.items():
            self.params[k] = str(v)

        return self

    def to_http(self) -> HttpResponseRedirect:
        redirect_url = (
            f"{self.base_url}/{self.path.lstrip('/')}?{urlencode(self.params)}"
        )
        return HttpResponseRedirect(redirect_url)
