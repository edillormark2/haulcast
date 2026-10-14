"""Django settings for the Haulcast API.

The API is stateless: every response is computed from upstream services
(routing, geocoding, weather) and nothing is persisted, so there is no
database. Upstream responses are cached in Django's cache instead.
All deploy-specific values come from environment variables.
"""

import os
from pathlib import Path

from django.core.management.utils import get_random_secret_key

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str]) -> list[str]:
    value = os.environ.get(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


DEBUG = env_bool("DJANGO_DEBUG")

# Nothing is signed or stored (no sessions, no auth), so an ephemeral key is
# safe when none is configured.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or get_random_secret_key()

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "[::1]"])

INSTALLED_APPS = [
    "rest_framework",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# Stateless service: any accidental database access fails loudly.
DATABASES: dict[str, dict[str, str]] = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "haulcast",
        "OPTIONS": {"MAX_ENTRIES": 20_000},
    },
    # Route geometries are large, so they get a small cache of their own.
    "routes": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "haulcast-routes",
        "OPTIONS": {"MAX_ENTRIES": 64},
    },
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# Deployed behind a TLS-terminating proxy (Vercel).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_RATES": {
        "geocode": os.environ.get("THROTTLE_GEOCODE", "120/min"),
        "plan": os.environ.get("THROTTLE_PLAN", "20/min"),
        "heatmap": os.environ.get("THROTTLE_HEATMAP", "20/min"),
    },
    "EXCEPTION_HANDLER": "planner.api.exceptions.api_exception_handler",
}

# Upstream services. All are keyless public APIs; point these at
# self-hosted instances to lift their fair-use limits.
PLANNER: dict[str, str] = {
    "VALHALLA_URL": os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de"),
    "OSRM_URL": os.environ.get("OSRM_URL", "https://router.project-osrm.org"),
    "PHOTON_URL": os.environ.get("PHOTON_URL", "https://photon.komoot.io"),
    "OPEN_METEO_URL": os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com"),
    # Fair-use policies ask clients to identify themselves; deployers can add
    # a contact URL here.
    "USER_AGENT": os.environ.get(
        "UPSTREAM_USER_AGENT", "Haulcast/0.1 (weather-aware truck routing demo)"
    ),
    "HTTP_TIMEOUT_SECONDS": os.environ.get("UPSTREAM_TIMEOUT_SECONDS", "25"),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "loggers": {
        "planner": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
    },
}
