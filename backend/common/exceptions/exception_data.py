class ExceptionDataParser:
    def __init__(self, exc, ErrorClass):
        self.exc = exc
        self.ErrorClass = ErrorClass

    def parse(self):
        status_code = (
            getattr(self.exc, "status_code", None)
            or self.ErrorClass.default_status_code
        )

        if hasattr(self.exc, "get_codes"):
            code = self.exc.get_codes()
            if isinstance(code, (list, dict)):
                code = getattr(self.exc, "default_code", None)
            else:
                code = code
        else:
            code = getattr(self.exc, "default_code", None)

        details = (
            getattr(self.exc, "detail", None)
            or (self.exc.args[0] if getattr(self.exc, "args", None) else None)
            or getattr(self.exc, "default_detail", None)
        )

        if isinstance(details, (dict, list)):
            fields = details
            details = None
        else:
            fields = None
            details = str(details) if details else self.ErrorClass.default_details

        if isinstance(self.exc, KeyError):
            details = f"Missing key: {self.exc}"

        return {
            "status_code": status_code,
            "code": code,
            "details": details,
            "fields": fields,
        }
