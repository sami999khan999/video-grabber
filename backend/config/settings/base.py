from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()


BASE_DIR = Path(__file__).resolve().parent.parent.parent
SECRET_KEY = os.environ.get("SECRET_KEY", "fallback-secret-key")

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
