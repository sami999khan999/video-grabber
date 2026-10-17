import os

from ..base import *

DEBUG = True
ALLOWED_HOSTS = os.environ.get("ALLOWED_HOSTS", "localhost,127.0.0.1,backend.com,api").split(",")
CSRF_COOKIE_SECURE = False
SESSION_COOKIE_SECURE = False
