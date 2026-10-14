"""Place search for the origin and destination fields."""

from __future__ import annotations

import hashlib

from django.core.cache import cache

from planner.integrations import photon
from planner.integrations.photon import Place

CACHE_TTL_S = 24 * 60 * 60
RESULT_LIMIT = 6


def search_places(query: str) -> list[Place]:
    normalized = " ".join(query.lower().split())
    key = "geocode:v1:" + hashlib.sha256(normalized.encode()).hexdigest()
    cached: list[Place] | None = cache.get(key)
    if cached is not None:
        return cached
    places = photon.search(normalized, limit=RESULT_LIMIT)
    cache.set(key, places, CACHE_TTL_S)
    return places
