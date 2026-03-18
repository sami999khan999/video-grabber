DJANGO_MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

THIRD_PARTY_MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
]

CUSTOM_MIDDLEWARE = [
    # Add project-specific middleware here
]

MIDDLEWARE = THIRD_PARTY_MIDDLEWARE + DJANGO_MIDDLEWARE + CUSTOM_MIDDLEWARE
