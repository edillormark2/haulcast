"""When the truck reaches each point of a route."""

from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from itertools import pairwise


@dataclass(frozen=True, slots=True)
class TravelTimeProfile:
    """Driving time since departure as a piecewise-linear function of distance.

    Breakpoints come from the router's maneuvers, so speed is constant within a
    maneuver (a stretch of one road) and changes between them. Driving is
    assumed continuous: no Hours-of-Service rest stops are inserted.
    """

    miles: tuple[float, ...]
    seconds: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.miles) != len(self.seconds) or len(self.miles) < 2:
            raise ValueError("A profile needs matching breakpoints, at least two")
        if any(b < a for a, b in pairwise(self.miles)):
            raise ValueError("Profile miles must be non-decreasing")
        if any(b < a for a, b in pairwise(self.seconds)):
            raise ValueError("Profile seconds must be non-decreasing")

    @property
    def total_seconds(self) -> float:
        return self.seconds[-1]

    def elapsed_seconds(self, mile: float) -> float:
        if mile <= self.miles[0]:
            return self.seconds[0]
        if mile >= self.miles[-1]:
            return self.seconds[-1]
        i = bisect_right(self.miles, mile)
        m0, m1 = self.miles[i - 1], self.miles[i]
        s0, s1 = self.seconds[i - 1], self.seconds[i]
        return s0 + (s1 - s0) * (mile - m0) / (m1 - m0)
