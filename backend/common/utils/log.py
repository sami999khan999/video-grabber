import logging
from typing import Union, Dict, Any

logger = logging.getLogger("app")

LOG_LEVEL_MAP = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "critical": logging.CRITICAL,
}


def log(level: Union[int, str], message: str = None, payload: Dict[str, Any] = None):

    if isinstance(level, str):
        level = LOG_LEVEL_MAP.get(level.lower(), logging.ERROR)

    if message is None:
        message = "ignored"

    extra = {}
    if payload is not None:
        extra["payload"] = payload

    logger.log(level, message, extra=extra)
