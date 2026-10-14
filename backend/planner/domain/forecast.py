"""Reading an hourly forecast at the moment the truck passes a point."""

from __future__ import annotations

import math
from dataclasses import dataclass

from planner.domain.risk import Conditions

HOUR_S = 3600


class ForecastUnavailableError(LookupError):
    """The forecast doesn't cover the requested time."""


@dataclass(frozen=True, slots=True)
class HourlySeries:
    """Hourly forecast for one location.

    Value `i` belongs to the top of the hour `start + i` hours (UTC unix
    seconds). Wind and gusts are instantaneous at that time. Rain and snow are
    totals over the preceding hour, which makes each one the in/hr rate for the
    hour that ends at its timestamp.
    """

    start: int
    wind_mph: tuple[float, ...]
    gust_mph: tuple[float, ...]
    rain_in: tuple[float, ...]
    snow_in: tuple[float, ...]

    def __post_init__(self) -> None:
        if self.start % HOUR_S:
            raise ValueError("Series must start at the top of an hour")
        lengths = {len(self.wind_mph), len(self.gust_mph), len(self.rain_in), len(self.snow_in)}
        if len(lengths) != 1:
            raise ValueError("All variables need one value per hour")

    @property
    def hours(self) -> int:
        return len(self.wind_mph)

    @property
    def end(self) -> int:
        """Timestamp of the last value."""
        return self.start + (self.hours - 1) * HOUR_S

    def conditions_at(self, timestamp: float) -> Conditions:
        """Weather at `timestamp`.

        Wind is interpolated linearly between the surrounding hours. Rain and
        snow use the forecast hour the truck is driving through, i.e. the total
        stamped at the next top of the hour.
        """
        offset_h = (timestamp - self.start) / HOUR_S
        hour = math.floor(offset_h)
        if hour < 0 or hour + 1 >= self.hours:
            raise ForecastUnavailableError(f"No forecast for timestamp {timestamp:.0f}")
        fraction = offset_h - hour
        return Conditions.measured(
            wind_mph=_lerp(self.wind_mph[hour], self.wind_mph[hour + 1], fraction),
            gust_mph=_lerp(self.gust_mph[hour], self.gust_mph[hour + 1], fraction),
            rain_in_hr=self.rain_in[hour + 1],
            snow_in_hr=self.snow_in[hour + 1],
        )

    def conditions_at_hour(self, index: int) -> Conditions:
        """Weather at the top of hour `index` (used by the heatmap frames)."""
        precipitation_hour = min(index + 1, self.hours - 1)
        return Conditions.measured(
            wind_mph=self.wind_mph[index],
            gust_mph=self.gust_mph[index],
            rain_in_hr=self.rain_in[precipitation_hour],
            snow_in_hr=self.snow_in[precipitation_hour],
        )


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t
