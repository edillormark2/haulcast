import pytest

from planner.domain.forecast import ForecastUnavailableError, HourlySeries
from planner.domain.timeline import TravelTimeProfile

HOUR = 3600
T0 = 1_792_000_800  # a top of the hour


def test_profile_interpolates_within_each_maneuver() -> None:
    # 60 mi in 1 h on the first road, then 30 mi in 1 h on a slower one.
    profile = TravelTimeProfile(miles=(0, 60, 90), seconds=(0, HOUR, 2 * HOUR))
    assert profile.elapsed_seconds(30) == pytest.approx(HOUR / 2)
    assert profile.elapsed_seconds(75) == pytest.approx(1.5 * HOUR)
    assert profile.elapsed_seconds(200) == 2 * HOUR
    assert profile.total_seconds == 2 * HOUR


def test_profile_rejects_decreasing_breakpoints() -> None:
    with pytest.raises(ValueError, match="non-decreasing"):
        TravelTimeProfile(miles=(0, 10, 5), seconds=(0, 1, 2))


def series() -> HourlySeries:
    return HourlySeries(
        start=T0,
        wind_mph=(10, 30, 50),
        gust_mph=(15, 40, 60),
        rain_in=(0.0, 0.12, 0.6),
        snow_in=(0.0, 0.0, 1.5),
    )


def test_wind_is_interpolated_between_hours() -> None:
    conditions = series().conditions_at(T0 + HOUR / 3)
    assert conditions.wind_mph == 16.7  # 10 + 20 / 3, rounded to 0.1 mph
    assert conditions.gust_mph == 23.3  # 15 + 25 / 3


def test_precipitation_uses_the_hour_being_driven_through() -> None:
    # 00:15 falls in the hour 00:00–01:00, whose total is stamped at 01:00.
    early = series().conditions_at(T0 + HOUR / 4)
    assert early.rain_in_hr == 0.12
    # 01:30 falls in 01:00–02:00, stamped at 02:00.
    later = series().conditions_at(T0 + 1.5 * HOUR)
    assert (later.rain_in_hr, later.snow_in_hr) == (0.6, 1.5)


def test_times_outside_the_forecast_raise() -> None:
    with pytest.raises(ForecastUnavailableError):
        series().conditions_at(T0 - 1)
    with pytest.raises(ForecastUnavailableError):
        series().conditions_at(T0 + 2 * HOUR)  # no hour after the last value


def test_series_must_start_on_the_hour() -> None:
    with pytest.raises(ValueError, match="top of an hour"):
        HourlySeries(start=T0 + 60, wind_mph=(1,), gust_mph=(1,), rain_in=(0,), snow_in=(0,))
