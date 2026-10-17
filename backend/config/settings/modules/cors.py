CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# The browser extension (any install id) talks to the API from its own pages
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^chrome-extension://[a-p]{32}$",
    r"^moz-extension://[0-9a-f-]{36}$",
]

CORS_ALLOW_CREDENTIALS = True

# Lets the frontend read the download filename when it runs on another origin (dev)
CORS_EXPOSE_HEADERS = ["Content-Disposition"]
