import os
from pathlib import Path

# The built Next.js app (static export) is served from the site root by WhiteNoise.
# In the Docker image it lives in /app/frontend; locally it's ../frontend/out after `pnpm build`.
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
FRONTEND_DIR = os.environ.get(
    "FRONTEND_DIR", str(BASE_DIR.parent / "frontend" / "out")
)

STATIC_URL = "static/"
WHITENOISE_ROOT = FRONTEND_DIR if os.path.isdir(FRONTEND_DIR) else None
WHITENOISE_INDEX_FILE = True
