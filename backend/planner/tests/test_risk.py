"""Every band edge in the brief's table, plus the load rules, pinned by value."""

import pytest

from planner.domain.risk import (
    RAIN_SCALE,
    SNOW_SCALE,
    WIND_SCALE,
    Conditions,
    Factor,
    RiskLevel,
    assess,
    describe,
)

L, M, H, S, NT = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)


@pytest.mark.parametrize(
    ("mph", "expected"),
    [
        (0, L),
        (24.9, L),
        (25, M),
        (34, M),
        (34.9, M),
        (35, H),
        (44, H),
        (44.9, H),
        (45, S),
        (54, S),
        (54.9, S),
        (55, NT),
        (80, NT),
    ],
)
def test_wind_bands(mph: float, expected: RiskLevel) -> None:
    assert WIND_SCALE.classify(mph) is expected


@pytest.mark.parametrize(
    ("in_hr", "expected"),
    [
        (0, L),
        (0.09, L),
        (0.10, M),
        (0.24, M),
        (0.25, H),
        (0.49, H),
        (0.50, S),
        (0.99, S),
        (1.00, S),
        (1.01, NT),
        (2.5, NT),
    ],
)
def test_rain_bands(in_hr: float, expected: RiskLevel) -> None:
    assert RAIN_SCALE.classify(in_hr) is expected


@pytest.mark.parametrize(
    ("in_hr", "expected"),
    [
        (0, L),
        (0.49, L),
        (0.5, M),
        (0.99, M),
        (1.0, H),
        (1.99, H),
        (2.0, S),
        (2.99, S),
        (3.0, S),
        (3.01, NT),
    ],
)
def test_snow_bands(in_hr: float, expected: RiskLevel) -> None:
    assert SNOW_SCALE.classify(in_hr) is expected


def calm(**overrides: float) -> Conditions:
    values = {"wind_mph": 5.0, "gust_mph": 8.0, "rain_in_hr": 0.0, "snow_in_hr": 0.0}
    return Conditions.measured(**(values | overrides))


@pytest.mark.parametrize(
    ("wind", "load", "expected"),
    [
        # ≥55 mph is No Travel whatever the load.
        (55, 0, NT),
        (60, 10_000, NT),
        # 45–54 mph: No Travel only above 30,000 lb (strictly).
        (45, 30_000, S),
        (45, 30_001, NT),
        (54.9, 45_000, NT),
        # 35–44 mph: Severe only above 40,000 lb (strictly).
        (35, 40_000, H),
        (35, 40_001, S),
        (44.9, 79_000, S),
        # Heavy loads don't escalate wind below 35 mph.
        (34.9, 80_000, M),
    ],
)
def test_load_rules(wind: float, load: float, expected: RiskLevel) -> None:
    assert assess(calm(wind_mph=wind), load_lb=load).level is expected


def test_load_rule_is_reported_when_it_raises_the_level() -> None:
    result = assess(calm(wind_mph=38), load_lb=42_000)
    assert result.level is S
    assert result.drivers == (Factor.WIND,)
    assert result.load_rule is not None
    assert "over 40,000 lb" in result.load_rule.description


def test_wind_at_55_is_no_travel_from_the_table_not_a_load_rule() -> None:
    result = assess(calm(wind_mph=55), load_lb=10_000)
    assert result.level is NT
    assert result.load_rule is None


def test_overall_level_is_the_worst_factor_and_lists_ties() -> None:
    result = assess(calm(wind_mph=36, rain_in_hr=0.30, snow_in_hr=0.2), load_lb=20_000)
    assert result.level is H
    assert result.drivers == (Factor.WIND, Factor.RAIN)
    assert result.factor_levels[Factor.SNOW] is L


def test_low_risk_has_no_drivers() -> None:
    result = assess(calm(), load_lb=20_000)
    assert result.level is L
    assert result.drivers == ()
    assert describe(calm(), result).startswith("Calm")


def test_measured_rounds_to_displayed_precision_before_classifying() -> None:
    # 0.248 in/hr displays as 0.25, so it must classify as High (0.25), not Moderate.
    conditions = Conditions.measured(wind_mph=34.96, gust_mph=40, rain_in_hr=0.248, snow_in_hr=0)
    assert conditions.rain_in_hr == 0.25
    assert conditions.wind_mph == 35.0
    assert assess(conditions, load_lb=0).factor_levels[Factor.RAIN] is H


def test_description_names_the_driving_factor_and_load_rule() -> None:
    conditions = calm(wind_mph=47.2)
    text = describe(conditions, assess(conditions, load_lb=35_000))
    assert text == "No Travel: Wind 47.2 mph (45–54 mph wind with a load over 30,000 lb)"


def test_levels_are_ordered_and_labelled() -> None:
    assert L < M < H < S < NT
    assert [level.label for level in RiskLevel] == [
        "Low",
        "Moderate",
        "High",
        "Severe",
        "No Travel",
    ]
