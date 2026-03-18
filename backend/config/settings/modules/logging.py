import json
import logging
import os
from pathlib import Path
from django.utils.timezone import now


BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
LOGS_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)


class LevelFilter(logging.Filter):
    def __init__(self, min_level=None, max_level=None):
        super().__init__()
        self.min_level = min_level
        self.max_level = max_level

    def filter(self, record):
        if self.min_level is not None and record.levelno < self.min_level:
            return False
        if self.max_level is not None and record.levelno > self.max_level:
            return False
        return True


class JsonLogFormatter(logging.Formatter):
    def format(self, record):
        log_record = {
            "timestamp": now().isoformat(),
            "level": record.levelname,
            "logger": record.name,
        }

        if hasattr(record, "payload") and isinstance(record.payload, dict):
            log_record["payload"] = record.payload

        if record.getMessage() != "ignored":
            log_record["message"] = record.getMessage()

        try:
            return json.dumps(log_record, default=str)
        except Exception:
            # Fallback for circular references or other serialization errors
            if "payload" in log_record:
                log_record["payload"] = str(log_record["payload"])
            return json.dumps(log_record, default=str)


class ConsoleFormatter(logging.Formatter):
    GREY = "\x1b[38;20m"
    YELLOW = "\x1b[33;20m"
    RED = "\x1b[31;20m"
    BOLD_RED = "\x1b[31;1m"
    GREEN = "\x1b[32;20m"
    BLUE = "\x1b[34;20m"
    CYAN = "\x1b[36;20m"
    RESET = "\x1b[0m"

    FORMATS = {
        logging.DEBUG: CYAN
        + "[%(levelname)s]"
        + RESET
        + " time=%(asctime)s name=%(name)s",
        logging.INFO: GREEN
        + "[%(levelname)s]"
        + RESET
        + " time=%(asctime)s name=%(name)s",
        logging.WARNING: YELLOW
        + "[%(levelname)s]"
        + RESET
        + " time=%(asctime)s name=%(name)s",
        logging.ERROR: RED
        + "[%(levelname)s]"
        + RESET
        + " time=%(asctime)s name=%(name)s",
        logging.CRITICAL: BOLD_RED
        + "[%(levelname)s]"
        + RESET
        + " time=%(asctime)s name=%(name)s",
    }

    def format(self, record):
        log_fmt = self.FORMATS.get(record.levelno, self.FORMATS[logging.INFO])
        formatter = logging.Formatter(log_fmt, datefmt=self.datefmt)
        base = formatter.format(record)

        parts = [base]

        message = record.getMessage()
        if message != "ignored":
            parts.append(f"{self.CYAN}message={message}{self.RESET}")

        if hasattr(record, "payload"):
            try:
                pretty_payload = json.dumps(record.payload)
            except Exception:
                pretty_payload = str(record.payload)

            parts.append(f"{self.BLUE}payload={pretty_payload}{self.RESET}")

        return " | ".join(parts)


LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": JsonLogFormatter,
        },
        "console": {
            "()": ConsoleFormatter,
        },
    },
    "filters": {
        "info_filter": {
            "()": LevelFilter,
            "min_level": logging.INFO,
            "max_level": logging.INFO,
        },
        "warning_filter": {
            "()": LevelFilter,
            "min_level": logging.WARNING,
            "max_level": logging.WARNING,
        },
        "error_filter": {
            "()": LevelFilter,
            "min_level": logging.ERROR,
            "max_level": logging.ERROR,
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "console",
        },
        "info_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": os.path.join(LOGS_DIR, "info.log"),
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "json",
            "filters": ["info_filter"],
        },
        "warning_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": os.path.join(LOGS_DIR, "warning.log"),
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "json",
            "filters": ["warning_filter"],
        },
        "error_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": os.path.join(LOGS_DIR, "errors.log"),
            "maxBytes": 5 * 1024 * 1024,
            "backupCount": 5,
            "formatter": "json",
            "filters": ["error_filter"],
        },
    },
    "loggers": {
        "app": {
            "handlers": ["console", "info_file", "warning_file", "error_file"],
            "level": "DEBUG",
            "propagate": False,
        },
        "django": {
            "handlers": ["console"],
            "level": "INFO",
            "propagate": True,
        },
    },
}
