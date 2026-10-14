import pytest

from planner.domain.recommendation import (
    Criterion,
    RouteCandidate,
    RouteExposure,
    format_duration,
    recommend,
)
from planner.domain.risk import RiskLevel

L, M, H, S, NT = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)
HOUR = 3600


def route(route_id: str, hours: float, stretches: list[tuple[float, RiskLevel]]) -> RouteCandidate:
    return RouteCandidate(
        route_id=route_id,
        name=f"Route {route_id}",
        duration_s=hours * HOUR,
        exposure=RouteExposure.from_stretches(stretches),
    )


def test_exposure_sums_miles_per_level_and_weights_the_average_by_distance() -> None:
    exposure = RouteExposure.from_stretches([(30, L), (10, H), (10, S)])
    assert exposure.miles(L) == 30
    assert exposure.miles(H) == 10
    assert exposure.miles(M) == 0
    # (30·0 + 10·2 + 10·3) / 50
    assert exposure.average_risk == pytest.approx(1.0)


def test_fewest_severe_miles_beats_a_much_faster_route() -> None:
    fast = route("A", 10, [(90, L), (10, S)])
    slow = route("B", 14, [(60, L), (40, H)])
    result = recommend([fast, slow])
    assert result.route_id == "B"
    assert result.comparisons[0].criterion is Criterion.SEVERE_MILES
    assert result.reason == "Route B avoids the 10 mi of Severe weather on Route A."


def test_high_miles_break_a_severe_tie() -> None:
    a = route("A", 10, [(80, L), (20, H)])
    b = route("B", 11, [(95, L), (5, H)])
    result = recommend([a, b])
    assert result.route_id == "B"
    assert result.comparisons[0].criterion is Criterion.HIGH_MILES
    assert result.reason == "Route B has less High-risk weather than Route A (5 mi vs 20 mi)."


def test_average_risk_breaks_a_severe_and_high_tie() -> None:
    a = route("A", 10, [(50, L), (50, M)])
    b = route("B", 12, [(90, L), (10, M)])
    result = recommend([a, b])
    assert result.route_id == "B"
    assert result.comparisons[0].criterion is Criterion.AVERAGE_RISK


def test_travel_time_decides_when_weather_risk_ties() -> None:
    a = route("A", 10.5, [(100, L)])
    b = route("B", 10, [(100, L)])
    result = recommend([a, b])
    assert result.route_id == "B"
    assert result.comparisons[0].criterion is Criterion.TRAVEL_TIME
    assert result.reason == "Route B matches Route A's weather risk while being 30 min faster."


def test_no_travel_miles_rank_before_severe_miles() -> None:
    blocked = route("A", 9, [(95, L), (5, NT)])
    severe = route("B", 12, [(40, L), (60, S)])
    result = recommend([blocked, severe])
    assert result.route_id == "B"
    assert result.comparisons[0].criterion is Criterion.NO_TRAVEL_MILES
    assert result.reason == "Route B avoids the 5 mi of No Travel conditions on Route A."
    assert result.warning == "Expect Severe weather on 60 mi of this route."


def test_warns_when_every_route_has_no_travel_miles() -> None:
    a = route("A", 9, [(90, L), (10, NT)])
    b = route("B", 9, [(70, L), (30, NT)])
    result = recommend([a, b])
    assert result.route_id == "A"
    assert result.warning is not None
    assert result.warning.startswith("Every route crosses No Travel conditions")


def test_float_noise_does_not_decide() -> None:
    a = route("A", 10, [(50.000001, L), (10.03, H)])
    b = route("B", 11, [(50, L), (10.0, H)])
    # 10.03 and 10.0 both round to 10.0 mi, so travel time decides.
    assert recommend([a, b]).comparisons[0].criterion is Criterion.TRAVEL_TIME


def test_ranking_lists_every_route_best_first() -> None:
    a = route("A", 10, [(100, S)])
    b = route("B", 10, [(100, H)])
    c = route("C", 10, [(100, L)])
    assert recommend([a, b, c]).ranking == ("C", "B", "A")


def test_reason_explains_the_win_over_every_other_route() -> None:
    fast_but_severe = route("A", 15.7, [(990, L), (25, S)])
    safe = route("B", 17.0, [(1078, L)])
    safe_but_slower = route("C", 17.4, [(1082, L)])
    result = recommend([fast_but_severe, safe, safe_but_slower])
    assert result.route_id == "B"
    assert [c.route_id for c in result.comparisons] == ["C", "A"]
    assert result.reason == (
        "Route B matches Route C's weather risk while being 24 min faster "
        "and avoids the 25 mi of Severe weather on Route A."
    )


def test_time_only_wins_are_merged_into_one_clause() -> None:
    a = route("A", 35.4, [(2015, L)])
    b = route("B", 37.3, [(2120, L)])
    c = route("C", 37.4, [(2071, L)])
    assert recommend([a, b, c]).reason == (
        "Route A matches the weather risk of Route B and Route C "
        "while being at least 1 h 54 min faster."
    )


def test_full_tie_is_explained() -> None:
    a = route("A", 10, [(100, L)])
    b = route("B", 10, [(100, L)])
    result = recommend([a, b])
    assert result.comparisons[0].criterion is None
    assert result.reason == "Route A ties with Route B on weather risk and travel time."


@pytest.mark.parametrize(
    ("seconds", "text"),
    [(45 * 60, "45 min"), (2 * HOUR, "2 h"), (2 * HOUR + 5 * 60, "2 h 5 min")],
)
def test_format_duration(seconds: float, text: str) -> None:
    assert format_duration(seconds) == text
