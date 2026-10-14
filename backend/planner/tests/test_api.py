"""The HTTP API end to end, with routing and weather services faked."""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from rest_framework.test import APIClient

from planner.tests.conftest import OPEN_METEO, VALHALLA_ROUTE

DALLAS = {"label": "Dallas, TX", "lat": 32.0, "lon": -97.0}
SHREVEPORT = {"label": "Somewhere east", "lat": 32.0, "lon": -95.0}


def soon() -> str:
    return (datetime.now(UTC) + timedelta(hours=1)).isoformat()


def plan_body(**overrides: Any) -> dict[str, Any]:
    body = {
        "origin": DALLAS,
        "destination": SHREVEPORT,
        "departure": soon(),
        "load_lb": 42_000,
        "interval_mi": 25,
    }
    return body | overrides


@pytest.fixture
def client() -> APIClient:
    return APIClient()


def test_health(client: APIClient) -> None:
    assert client.get("/api/health/").json() == {"status": "ok"}


def test_rules_expose_the_brief_tables(client: APIClient) -> None:
    rules = client.get("/api/rules/").json()
    assert rules["factors"]["wind"]["bounds"] == [25, 35, 45, 55]
    assert rules["factors"]["rain"]["no_travel_inclusive"] is False
    assert [r["heavier_than_lb"] for r in rules["load_rules"]] == [None, 30_000, 40_000]
    assert rules["recommendation_order"][0] == "no_travel_miles"


def test_plan_ranks_routes_by_weather_exposure(client: APIClient, upstream: Any) -> None:
    # 38 mph wind on the fastest route (latitude 32.0): Severe for a 42,000 lb load.
    upstream(lambda lat, lon: {"wind": 38.0} if abs(lat - 32.0) < 0.05 else {"wind": 8.0})

    response = client.post("/api/plans/", plan_body(), format="json")

    assert response.status_code == 200
    plan = response.json()
    routes = {route["id"]: route for route in plan["routes"]}
    assert set(routes) == {"A", "B", "C"}
    assert routes["A"]["exposure"]["miles"]["severe"] > 100  # the whole fastest route
    assert plan["recommendation"]["route_id"] == "B"  # next fastest, calm
    assert plan["recommendation"]["ranking"] == ["B", "C", "A"]
    assert "avoids the" in plan["recommendation"]["reason"]
    assert routes["B"]["via"] == "via US-80"
    assert plan["thresholds"]["wind"]["bounds"] == [25, 35, 35, 45]

    checkpoints = routes["A"]["checkpoints"]
    assert [round(cp["mile"]) for cp in checkpoints][:3] == [0, 25, 50]
    assert checkpoints[1]["risk"] == "severe"
    assert checkpoints[1]["load_rule"] == "35–44 mph wind with a load over 40,000 lb"
    assert checkpoints[1]["eta"] > plan["trip"]["departure"]


def test_plan_sections_cover_each_route(client: APIClient, upstream: Any) -> None:
    upstream(lambda lat, lon: {"rain": 0.3} if lon > -96 else {})
    route = client.post("/api/plans/", plan_body(), format="json").json()["routes"][0]
    sections = route["sections"]
    assert sections[0]["from_mi"] == 0
    assert sections[-1]["to_mi"] == pytest.approx(route["distance_mi"], abs=0.1)
    assert {s["level"] for s in sections} == {"low", "high"}
    assert sections[-1]["end"] == len(route["geometry"]) - 1


def test_heatmap_packs_frames_for_webgl(client: APIClient, upstream: Any) -> None:
    upstream(lambda lat, lon: {"wind": 20.0})
    plan = client.post("/api/plans/", plan_body(), format="json").json()

    heatmap = client.post("/api/heatmap/", plan["heatmap_request"], format="json").json()

    grid = heatmap["grid"]
    data = base64.b64decode(heatmap["data"])
    assert heatmap["frames"] == 49
    assert len(data) == grid["columns"] * grid["rows"] * heatmap["frames"] * 4
    assert max(data[0::4]) == 40  # 20 mph in 0.5 mph steps
    assert heatmap["thresholds"]["wind"]["bounds"] == [25, 35, 35, 45]


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"departure": "2020-01-01T00:00:00Z"}, "departure"),
        ({"interval_mi": 15}, "interval_mi"),
        ({"load_lb": 90_000}, "load_lb"),
        ({"destination": DALLAS}, "destination"),
    ],
)
def test_plan_validation_errors_name_the_field(
    client: APIClient, overrides: dict[str, Any], field: str
) -> None:
    response = client.post("/api/plans/", plan_body(**overrides), format="json")
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert field in error["fields"] or field in str(error["fields"])


def test_no_route_is_a_clear_422(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {})
    router.post(VALHALLA_ROUTE).mock(
        return_value=httpx.Response(400, json={"error": "No path could be found for input"})
    )
    response = client.post("/api/plans/", plan_body(), format="json")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_route"


def test_rate_limited_weather_is_reported_as_busy(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {})
    router.get(OPEN_METEO).mock(return_value=httpx.Response(429, json={"reason": "Too many"}))
    response = client.post("/api/plans/", plan_body(), format="json")
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "upstream_busy",
        "message": "Open-Meteo is busy right now. Try again in a minute.",
        "service": "Open-Meteo",
    }
