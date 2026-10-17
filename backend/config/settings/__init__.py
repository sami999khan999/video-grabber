import os

ENVIRONMENT = os.environ.get("DJANGO_ENV", "dev")

from .modules.apps import *
from .modules.middlewares import *
from .modules.drf import *
from .modules.cors import *
from .modules.i18n import *
from .modules.security import *
from .modules.logging import *
from .modules.frontend import *


env_module_path = f"config.settings.environments.{ENVIRONMENT}"
try:
    env_module = __import__(env_module_path, fromlist=["*"])

    for attr in dir(env_module):
        if attr.isupper():
            globals()[attr] = getattr(env_module, attr)
except ImportError:
    raise ImportError(f"Settings for environment '{ENVIRONMENT}' not found.")
