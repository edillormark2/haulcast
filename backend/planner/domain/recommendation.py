"""Comparing route options and picking the one to recommend.

The brief's preference order is lexicographic:
    1. fewest Severe miles  2. fewest High miles  3. lowest average risk
    4. shortest travel time
The brief doesn't rank No Travel because it isn't a degree of risk but a
stop: any route with No Travel miles can't be driven as planned. So No Travel
miles are compared first, ahead of the brief's four criteria.

Values are compared at the precision the UI shows (0.1 mi, 0.01 average risk,
whole minutes), so floating-point noise never decides a recommendation and the
explanation never contradicts the numbers on screen.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import assert_never

from planner.domain.risk import RiskLevel


@dataclass(frozen=True, slots=True)
class RouteExposure:
    """Miles of a route in each risk level, and the distance-weighted average
    risk score (0 = Low … 4 = No Travel)."""

    miles_by_level: dict[RiskLevel, float]
    average_risk: float

    @classmethod
    def from_stretches(cls, stretches: Iterable[tuple[float, RiskLevel]]) -> RouteExposure:
        """Build from (miles, level) pairs, one per checkpoint stretch."""
        miles = dict.fromkeys(RiskLevel, 0.0)
        for length_mi, level in stretches:
            miles[level] += length_mi
        total = sum(miles.values())
        average = sum(level * length for level, length in miles.items()) / total if total else 0.0
        return cls(miles_by_level=miles, average_risk=average)

    def miles(self, level: RiskLevel) -> float:
        return self.miles_by_level[level]


@dataclass(frozen=True, slots=True)
class RouteCandidate:
    route_id: str
    name: str
    duration_s: float
    exposure: RouteExposure


class Criterion(StrEnum):
    NO_TRAVEL_MILES = "no_travel_miles"
    SEVERE_MILES = "severe_miles"
    HIGH_MILES = "high_miles"
    AVERAGE_RISK = "average_risk"
    TRAVEL_TIME = "travel_time"


CRITERIA_ORDER: tuple[Criterion, ...] = tuple(Criterion)


def criteria_values(candidate: RouteCandidate) -> tuple[float, ...]:
    """The ranking key, in CRITERIA_ORDER. Lower is better for every element."""
    exposure = candidate.exposure
    return (
        round(exposure.miles(RiskLevel.NO_TRAVEL), 1),
        round(exposure.miles(RiskLevel.SEVERE), 1),
        round(exposure.miles(RiskLevel.HIGH), 1),
        round(exposure.average_risk, 2),
        round(candidate.duration_s / 60),
    )


@dataclass(frozen=True, slots=True)
class Comparison:
    """Why the recommended route beats one other route."""

    route_id: str
    criterion: Criterion | None
    """The first criterion that separates the two (None when they tie)."""
    text: str
    """Completes "<recommended route> …", e.g. "avoids the 25 mi of Severe weather on Route A"."""
    verdict: str
    """Why the other route lost, from its own point of view, e.g. "25 mi of Severe weather"."""


@dataclass(frozen=True, slots=True)
class Recommendation:
    route_id: str
    ranking: tuple[str, ...]
    """Route ids, best first."""
    comparisons: tuple[Comparison, ...]
    """One per other route, in ranking order."""
    reason: str
    warning: str | None
    """Set when even the recommended route crosses Severe or No Travel weather."""


def recommend(candidates: Sequence[RouteCandidate]) -> Recommendation:
    if not candidates:
        raise ValueError("Nothing to recommend without route options")
    ranked = sorted(candidates, key=criteria_values)
    best, others = ranked[0], ranked[1:]
    comparisons = tuple(_compare(best, other) for other in others)
    return Recommendation(
        route_id=best.route_id,
        ranking=tuple(c.route_id for c in ranked),
        comparisons=comparisons,
        reason=_reason(best, others, comparisons),
        warning=_warning(best, everyone_blocked=all(_has_no_travel(c) for c in ranked)),
    )


def _deciding_criterion(best: RouteCandidate, other: RouteCandidate) -> Criterion | None:
    for criterion, mine, theirs in zip(
        CRITERIA_ORDER, criteria_values(best), criteria_values(other), strict=True
    ):
        if mine != theirs:
            return criterion
    return None


def _compare(best: RouteCandidate, other: RouteCandidate) -> Comparison:
    """A clause completing "<best> …", e.g. "avoids the 25 mi of Severe weather on Route A"."""
    criterion = _deciding_criterion(best, other)
    mine, theirs, name = best.exposure, other.exposure, other.name

    def exposure(level: RiskLevel, weather: str) -> tuple[str, str]:
        ours, their = _miles_pair(mine.miles(level), theirs.miles(level))
        if mine.miles(level) == 0:
            return f"avoids the {their} of {weather} on {name}", f"{their} of {weather}"
        return (
            f"has less {weather} than {name} ({ours} vs {their})",
            f"{their} of {weather}, vs {ours} on {best.name}",
        )

    match criterion:
        case None:
            text = f"ties with {name} on weather risk and travel time"
            verdict = f"Ties with {best.name}"
        case Criterion.NO_TRAVEL_MILES:
            text, verdict = exposure(RiskLevel.NO_TRAVEL, "No Travel conditions")
        case Criterion.SEVERE_MILES:
            text, verdict = exposure(RiskLevel.SEVERE, "Severe weather")
        case Criterion.HIGH_MILES:
            text, verdict = exposure(RiskLevel.HIGH, "High-risk weather")
        case Criterion.AVERAGE_RISK:
            text = (
                f"has lower average risk than {name} "
                f"({mine.average_risk:.2f} vs {theirs.average_risk:.2f})"
            )
            verdict = f"Higher average risk: {theirs.average_risk:.2f} vs {mine.average_risk:.2f}"
        case Criterion.TRAVEL_TIME:
            slower = format_duration(other.duration_s - best.duration_s)
            text = f"matches {name}'s weather risk while being {slower} faster"
            verdict = f"Same weather risk, {slower} slower"
        case _:
            assert_never(criterion)
    verdict = verdict[0].upper() + verdict[1:]
    return Comparison(route_id=other.route_id, criterion=criterion, text=text, verdict=verdict)


def _reason(
    best: RouteCandidate, others: Sequence[RouteCandidate], comparisons: Sequence[Comparison]
) -> str:
    """One sentence on why `best` wins, with time-only wins merged into one clause."""
    if not comparisons:
        return "Only one route was found for this trip."
    faster_than = [
        other
        for other, comparison in zip(others, comparisons, strict=True)
        if comparison.criterion is Criterion.TRAVEL_TIME
    ]
    clauses = [c.text for c in comparisons if c.criterion is not Criterion.TRAVEL_TIME]
    if len(faster_than) > 1:
        saved = format_duration(min(o.duration_s for o in faster_than) - best.duration_s)
        names = _join([o.name for o in faster_than])
        clauses.insert(
            0, f"matches the weather risk of {names} while being at least {saved} faster"
        )
    elif faster_than:
        clauses.insert(0, next(c.text for c in comparisons if c.criterion is Criterion.TRAVEL_TIME))
    return f"{best.name} {_join(clauses)}."


def _join(items: Sequence[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _warning(best: RouteCandidate, *, everyone_blocked: bool) -> str | None:
    no_travel = best.exposure.miles(RiskLevel.NO_TRAVEL)
    severe = best.exposure.miles(RiskLevel.SEVERE)
    if everyone_blocked:
        return (
            f"Every route crosses No Travel conditions at this departure time "
            f"({format_miles(no_travel)} on the best one). Consider leaving later."
        )
    if severe > 0:
        return f"Expect Severe weather on {format_miles(severe)} of this route."
    return None


def _has_no_travel(candidate: RouteCandidate) -> bool:
    return round(candidate.exposure.miles(RiskLevel.NO_TRAVEL), 1) > 0


def _miles_pair(a: float, b: float) -> tuple[str, str]:
    """Format two distances so that different values never print the same."""
    digits = 0 if round(a) != round(b) else 1
    return format_miles(a, digits), format_miles(b, digits)


def format_miles(miles: float, digits: int = 0) -> str:
    return f"{miles:,.{digits}f} mi"


def format_duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} h {minutes} min"
    return f"{hours} h" if hours else f"{minutes} min"
