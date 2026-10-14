"""Vercel entry point: the Django API as one Python function.

Vercel rewrites every /api/* request here (see vercel.json) and hands the
original path to Django, so the URLconf is the same as in local development.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from config.wsgi import application as app  # noqa: E402

__all__ = ["app"]
