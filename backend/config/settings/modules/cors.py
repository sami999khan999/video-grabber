CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

CORS_ALLOW_CREDENTIALS = True

# Lets the frontend read the download filename when it runs on another origin (dev)
CORS_EXPOSE_HEADERS = ["Content-Disposition"]
