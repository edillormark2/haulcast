"""Upstream rate limits and failures: what is retried, what is reported, and
how forecast lookups keep their progress and fall back to older forecasts."""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence

import httpx
import pytest
import respx

from planner.domain.forecast import HOUR_S, HourlySeries
from planner.domain.geometry import Coordinate
from planner.integrations import open_meteo
from planner.integrations.http import UpstreamError, request_json
from planner.services import forecasts
from planner.services.forecasts import ForecastWindow, fetch_forecasts
from planner.tests.conftest import refusal

WINDOW = ForecastWindow.covering(1_792_000_800, hours=10)
POINTS = [Coordinate(32.0, -97.0 + 0.2 * i) for i in range(5)]


def test_a_long_retry_after_fails_at_once_with_the_wait() -> None:
    with respx.mock() as router:
        route = router.get("https://example.test/").mock(
            return_value=httpx.Response(429, headers={"Retry-After": "30"})
        )
        with pytest.raises(UpstreamError) as caught:
            request_json("Example", "GET", "https://example.test/")
    assert caught.value.retry_after_s == 30
    assert route.call_count == 1


@pytest.mark.parametrize(
    ("reason", "shortest", "longest"),
    [
        ("Minutely API request limit exceeded. Please try again in one minute.", 20, 20),
        ("Hourly API request limit exceeded. Please try again in the next hour.", 61, 3660),
        ("Daily API request limit exceeded. Please try again tomorrow.", 61, 86_460),
    ],
)
def test_open_meteo_refusals_say_how_long_they_last(
    reason: str, shortest: float, longest: float
) -> None:
    wait = open_meteo._retry_after(refusal(reason))
    assert wait is not None
    assert shortest <= wait <= longest


def test_too_many_concurrent_requests_gets_the_usual_backoff() -> None:
    assert open_meteo._retry_after(refusal("Too many concurrent requests")) is None


class FakeOpenMeteo:
    """Calm weather for every point, except the calls numbered in `refuse`."""

    def __init__(self, refuse: Sequence[int], delay_s: float) -> None:
        self.refuse = set(refuse)
        self.delay_s = delay_s
        self.requested: list[Coordinate] = []
        self.served: list[Coordinate] = []
        self.calls = 0

    def __call__(self, points: Sequence[Coordinate], start: int, end: int) -> list[HourlySeries]:
        self.calls += 1
        self.requested += points
        if self.calls in self.refuse:
            raise UpstreamError("Open-Meteo", "HTTP 429", status=429, retry_after_s=20)
        time.sleep(self.delay_s)
        self.served += points
        hours = (end - start) // HOUR_S + 1
        calm = HourlySeries(start, (5.0,) * hours, (9.0,) * hours, (0.0,) * hours, (0.0,) * hours)
        return [calm for _ in points]


@pytest.fixture
def open_meteo_fake(monkeypatch: pytest.MonkeyPatch) -> Callable[..., FakeOpenMeteo]:
    """Replaces Open-Meteo with a calm fake at once; calling the fixture swaps
    in a new one. Two points per request, so a lookup takes several batches."""
    monkeypatch.setattr(open_meteo, "MAX_LOCATIONS_PER_REQUEST", 2)

    def install(refuse: Sequence[int] = (), delay_s: float = 0) -> FakeOpenMeteo:
        fake = FakeOpenMeteo(refuse, delay_s)
        monkeypatch.setattr(open_meteo, "fetch_hourly", fake)
        return fake

    install()
    return install


def test_cached_forecasts_cost_no_calls(open_meteo_fake: Callable[..., FakeOpenMeteo]) -> None:
    fetch_forecasts(POINTS, WINDOW)
    fake = open_meteo_fake()
    lookup = fetch_forecasts(POINTS, WINDOW)
    assert fake.requested == []
    assert (lookup.cell_count, lookup.fetched) == (5, 0)


def test_a_refusal_keeps_the_batches_that_arrived(
    open_meteo_fake: Callable[..., FakeOpenMeteo],
) -> None:
    refusing = open_meteo_fake(refuse=[2])
    with pytest.raises(UpstreamError):
        fetch_forecasts(POINTS, WINDOW)
    assert refusing.served

    retry = open_meteo_fake()
    lookup = fetch_forecasts(POINTS, WINDOW)
    # The retry pays only for what the refused attempt didn't get.
    assert set(retry.requested) == set(POINTS) - set(refusing.served)
    assert lookup.fetched == len(retry.requested)


def test_after_a_refusal_queued_batches_are_not_sent(
    open_meteo_fake: Callable[..., FakeOpenMeteo], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(forecasts, "PARALLEL_REQUESTS", 1)
    points = [Coordinate(32.0, -97.0 + 0.2 * i) for i in range(10)]  # five batches
    fake = open_meteo_fake(refuse=[1], delay_s=0.1)
    with pytest.raises(UpstreamError):
        fetch_forecasts(points, WINDOW)
    assert fake.calls < 5


def test_older_forecasts_stand_in_when_open_meteo_refuses(
    open_meteo_fake: Callable[..., FakeOpenMeteo], monkeypatch: pytest.MonkeyPatch
) -> None:
    first = fetch_forecasts(POINTS, WINDOW)
    monkeypatch.setattr(forecasts, "FRESH_S", 0)  # every cached forecast is now old
    open_meteo_fake(refuse=range(1, 10))

    lookup = fetch_forecasts(POINTS, WINDOW)

    assert lookup.stale_since is not None
    assert lookup.stale_since <= time.time()
    assert lookup[POINTS[0]] == first[POINTS[0]]


def test_a_refusal_fails_the_lookup_when_a_cell_was_never_fetched(
    open_meteo_fake: Callable[..., FakeOpenMeteo], monkeypatch: pytest.MonkeyPatch
) -> None:
    fetch_forecasts(POINTS[:2], WINDOW)
    monkeypatch.setattr(forecasts, "FRESH_S", 0)
    open_meteo_fake(refuse=range(1, 10))
    with pytest.raises(UpstreamError):
        fetch_forecasts(POINTS, WINDOW)
