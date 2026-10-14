"""Typed access to the planner's settings (settings.PLANNER)."""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings


@dataclass(frozen=True, slots=True)
class UpstreamConfig:
    valhalla_url: str
    osrm_url: str
    photon_url: str
    open_meteo_url: str
    user_agent: str
    timeout_s: float


def upstream() -> UpstreamConfig:
    config = settings.PLANNER
    return UpstreamConfig(
        valhalla_url=config["VALHALLA_URL"].rstrip("/"),
        osrm_url=config["OSRM_URL"].rstrip("/"),
        photon_url=config["PHOTON_URL"].rstrip("/"),
        open_meteo_url=config["OPEN_METEO_URL"].rstrip("/"),
        user_agent=config["USER_AGENT"],
        timeout_s=float(config["HTTP_TIMEOUT_SECONDS"]),
    )
