"""Photon geocoder (OpenStreetMap data, built for search-as-you-type).

https://photon.komoot.io — keyless, fair use.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from planner import conf
from planner.integrations.http import request_json

SERVICE = "Photon"
# Bias results to North America, where the risk rules' US units apply.
NORTH_AMERICA_BBOX = "-170,14,-50,72"


@dataclass(frozen=True, slots=True)
class Place:
    name: str
    detail: str
    lat: float
    lon: float
    kind: str

    @property
    def label(self) -> str:
        return f"{self.name}, {self.detail}" if self.detail else self.name


def search(query: str, *, limit: int) -> list[Place]:
    url = f"{conf.upstream().photon_url}/api/"
    params = {"q": query, "limit": limit * 2, "lang": "en", "bbox": NORTH_AMERICA_BBOX}
    payload = request_json(SERVICE, "GET", url, params=params)
    places: list[Place] = []
    seen: set[str] = set()
    for feature in payload.get("features", []):
        place = _to_place(feature)
        if place and place.label not in seen:
            seen.add(place.label)
            places.append(place)
    return places[:limit]


def _to_place(feature: dict[str, Any]) -> Place | None:
    props = feature.get("properties") or {}
    coordinates = (feature.get("geometry") or {}).get("coordinates") or []
    if len(coordinates) != 2:
        return None

    street = " ".join(filter(None, (props.get("housenumber"), props.get("street"))))
    name = props.get("name") or street
    if not name:
        return None
    region = props.get("state")
    country = (props.get("countrycode") or "").upper()
    detail_parts = [part for part in (props.get("city"), region, country) if part and part != name]
    return Place(
        name=name,
        detail=", ".join(dict.fromkeys(detail_parts)),
        lat=float(coordinates[1]),
        lon=float(coordinates[0]),
        kind=props.get("type") or props.get("osm_value") or "place",
    )
