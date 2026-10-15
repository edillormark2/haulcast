"""The HTTP API end to end, with routing and weather services faked."""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
import respx
from rest_framework.test import APIClient

from planner.services import forecasts
from planner.tests.conftest import VALHALLA_ROUTE, refusal, requested_points

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


def test_rules_are_cached_by_the_cdn(client: APIClient) -> None:
    cache_control = client.get("/api/rules/")["Cache-Control"]
    assert "public" in cache_control
    assert "s-maxage=86400" in cache_control


def test_place_search_is_cached_by_the_cdn(client: APIClient) -> None:
    feature = {
        "geometry": {"coordinates": [-96.797, 32.7767]},
        "properties": {"name": "Dallas", "state": "Texas", "countrycode": "us", "type": "city"},
    }
    with respx.mock() as router:
        photon = router.get("https://photon.komoot.io/api/").mock(
            return_value=httpx.Response(200, json={"features": [feature]})
        )
        response = client.get("/api/geocode/", {"q": "Dallas"})

    assert photon.called
    assert response.json()["results"][0]["label"] == "Dallas, Texas, US"
    assert "s-maxage=86400" in response["Cache-Control"]


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


def test_heatmap_reuses_the_plans_checkpoint_forecasts(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {"wind": 20.0})
    plan = client.post("/api/plans/", plan_body(), format="json").json()
    open_meteo = router["open_meteo"]
    open_meteo.reset()

    heatmap = client.post("/api/heatmap/", plan["heatmap_request"], format="json").json()

    # Cells the routes cross read the checkpoints the plan already fetched;
    # only the rest cost Open-Meteo calls.
    anchors = {(lat, lon) for lon, lat in plan["heatmap_request"]["anchors"]}
    fetched = requested_points(open_meteo)
    meta = heatmap["meta"]
    assert len(fetched) == meta["fetched_cells"] < meta["forecast_cells"]
    assert anchors.isdisjoint(fetched)
    assert max(base64.b64decode(heatmap["data"])[0::4]) == 40  # 20 mph everywhere


def test_heatmap_request_is_the_same_at_every_interval(client: APIClient, upstream: Any) -> None:
    upstream(lambda lat, lon: {})
    requests = [
        client.post("/api/plans/", plan_body(interval_mi=mi), format="json").json()[
            "heatmap_request"
        ]
        for mi in (10, 25, 50)
    ]
    # So switching the interval keeps the heatmap the browser already has.
    assert requests[0] == requests[1] == requests[2]
    assert len(requests[0]["anchors"]) > 3


def test_rate_limited_weather_is_reported_as_busy(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {})
    open_meteo = router["open_meteo"].mock(
        return_value=refusal("Minutely API request limit exceeded. Please try again in one minute.")
    )
    response = client.post("/api/plans/", plan_body(), format="json")
    assert response.status_code == 503
    assert response["Retry-After"] == "20"
    assert response.json()["error"] == {
        "code": "upstream_busy",
        "message": "Open-Meteo is busy right now. Try again in a minute.",
        "service": "Open-Meteo",
        "retry_after": 20,
    }
    # A spent minute can't recover within the request, so nothing is retried.
    assert open_meteo.call_count == 1


def test_a_used_up_quota_says_when_to_come_back(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {})
    router["open_meteo"].mock(
        return_value=refusal(
            "Hourly API request limit exceeded. Please try again in the next hour."
        )
    )
    error = client.post("/api/plans/", plan_body(), format="json").json()["error"]
    assert error["code"] == "upstream_busy"
    assert 60 < error["retry_after"] <= 3660
    assert error["message"].startswith("This server has used up Open-Meteo's free quota for now.")


def test_too_many_concurrent_requests_are_retried(client: APIClient, upstream: Any) -> None:
    router = upstream(lambda lat, lon: {})
    answer = router["open_meteo"].side_effect
    replies = iter([refusal("Too many concurrent requests")])
    router["open_meteo"].mock(side_effect=lambda request: next(replies, None) or answer(request))
    assert client.post("/api/plans/", plan_body(), format="json").status_code == 200


def test_older_forecasts_stand_in_when_open_meteo_refuses(
    client: APIClient, upstream: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    router = upstream(lambda lat, lon: {"wind": 38.0})
    first = client.post("/api/plans/", plan_body(), format="json").json()
    monkeypatch.setattr(forecasts, "FRESH_S", 0)  # every cached forecast is now old
    router["open_meteo"].mock(return_value=refusal("Hourly API request limit exceeded."))

    response = client.post("/api/plans/", plan_body(), format="json")

    assert response.status_code == 200
    plan = response.json()
    assert plan["recommendation"] == first["recommendation"]
    assert plan["meta"]["stale_since"] is not None
    assert plan["notes"] == [
        "Open-Meteo couldn't send fresh forecasts, so this plan uses ones fetched 1 min ago."
    ]
