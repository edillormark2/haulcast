"""Weather risk at a single checkpoint, implementing the brief's rules exactly.

Threshold table (per checkpoint):

    Condition   Low        Moderate    High        Severe      No Travel
    Wind        <25 mph    25–34       35–44       45–54       ≥55 mph
    Rain        <0.10 in/h 0.10–0.25   0.25–0.50   0.50–1.00   >1.00
    Snow        <0.5 in/h  0.5–1.0     1.0–2.0     2.0–3.0     >3.0

Load rules:
    ≥55 mph               → No Travel for any load
    45–54 mph + >30,000 lb → No Travel
    35–44 mph + >40,000 lb → Severe

Boundary conventions (the table's bands share endpoints, e.g. 0.25 sits in
both Moderate and High):
    * Each band's lower bound is inclusive, so a shared endpoint belongs to the
      higher band: 0.25 in/h of rain is High, 35 mph is High.
    * Wind bands are written as whole numbers; they are read as continuous
      half-open ranges, so 34.6 mph is Moderate and 54.9 mph is Severe.
    * No Travel starts exactly where the table says: "≥55" includes 55 mph,
      while ">1.00" and ">3.0" exclude 1.00 and 3.0, which stay Severe.
    * Load limits are strict: exactly 30,000 lb or 40,000 lb does not escalate.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum, StrEnum


class RiskLevel(IntEnum):
    """Ordered risk levels. The integer value is the score used for averages."""

    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4

    @property
    def label(self) -> str:
        return "No Travel" if self is RiskLevel.NO_TRAVEL else self.name.title()

    @property
    def slug(self) -> str:
        return self.name.lower()


class Factor(StrEnum):
    WIND = "wind"
    RAIN = "rain"
    SNOW = "snow"


@dataclass(frozen=True, slots=True)
class BandScale:
    """Inclusive lower bounds of the Moderate, High and Severe bands, plus the
    No Travel limit, for one weather factor."""

    moderate: float
    high: float
    severe: float
    no_travel: float
    no_travel_inclusive: bool
    unit: str

    def lower_bound(self, level: RiskLevel) -> float:
        """The value where `level` starts (Low starts at 0)."""
        return {
            RiskLevel.LOW: 0.0,
            RiskLevel.MODERATE: self.moderate,
            RiskLevel.HIGH: self.high,
            RiskLevel.SEVERE: self.severe,
            RiskLevel.NO_TRAVEL: self.no_travel,
        }[level]

    def classify(self, value: float) -> RiskLevel:
        if value > self.no_travel or (self.no_travel_inclusive and value == self.no_travel):
            return RiskLevel.NO_TRAVEL
        if value >= self.severe:
            return RiskLevel.SEVERE
        if value >= self.high:
            return RiskLevel.HIGH
        if value >= self.moderate:
            return RiskLevel.MODERATE
        return RiskLevel.LOW


WIND_SCALE = BandScale(25, 35, 45, 55, no_travel_inclusive=True, unit="mph")
RAIN_SCALE = BandScale(0.10, 0.25, 0.50, 1.00, no_travel_inclusive=False, unit="in/hr")
SNOW_SCALE = BandScale(0.5, 1.0, 2.0, 3.0, no_travel_inclusive=False, unit="in/hr")

SCALES: dict[Factor, BandScale] = {
    Factor.WIND: WIND_SCALE,
    Factor.RAIN: RAIN_SCALE,
    Factor.SNOW: SNOW_SCALE,
}


@dataclass(frozen=True, slots=True)
class LoadRule:
    """Raises wind risk to `level` when wind is in [min_wind, max_wind) and the
    load is heavier than `heavier_than_lb` (None means any load)."""

    min_wind_mph: float
    max_wind_mph: float
    heavier_than_lb: float | None
    level: RiskLevel
    description: str

    def applies(self, wind_mph: float, load_lb: float) -> bool:
        in_wind_band = self.min_wind_mph <= wind_mph < self.max_wind_mph
        heavy_enough = self.heavier_than_lb is None or load_lb > self.heavier_than_lb
        return in_wind_band and heavy_enough


LOAD_RULES: tuple[LoadRule, ...] = (
    LoadRule(55, float("inf"), None, RiskLevel.NO_TRAVEL, "≥55 mph wind, any load"),
    LoadRule(45, 55, 30_000, RiskLevel.NO_TRAVEL, "45–54 mph wind with a load over 30,000 lb"),
    LoadRule(35, 45, 40_000, RiskLevel.SEVERE, "35–44 mph wind with a load over 40,000 lb"),
)


def wind_scale_for_load(load_lb: float) -> BandScale:
    """The wind bands with the load rules folded in, so the heatmap and legends
    can classify wind for this load with plain thresholds.

    Each level starts at the lowest wind speed that reaches it, from the table
    or from any load rule that applies to this load. This is exact because risk
    never decreases as wind rises (a test checks it against `assess`).
    """

    def start(level: RiskLevel) -> float:
        rule_starts = [
            rule.min_wind_mph
            for rule in LOAD_RULES
            if rule.level >= level
            and (rule.heavier_than_lb is None or load_lb > rule.heavier_than_lb)
        ]
        return min([WIND_SCALE.lower_bound(level), *rule_starts])

    return BandScale(
        moderate=start(RiskLevel.MODERATE),
        high=start(RiskLevel.HIGH),
        severe=start(RiskLevel.SEVERE),
        no_travel=start(RiskLevel.NO_TRAVEL),
        no_travel_inclusive=True,
        unit=WIND_SCALE.unit,
    )


def scales_for_load(load_lb: float) -> dict[Factor, BandScale]:
    return {
        Factor.WIND: wind_scale_for_load(load_lb),
        Factor.RAIN: RAIN_SCALE,
        Factor.SNOW: SNOW_SCALE,
    }


@dataclass(frozen=True, slots=True)
class Conditions:
    """Weather the truck meets at a checkpoint. Rates are inches per hour.

    Use `Conditions.measured` to build one: it rounds readings to the precision
    the UI displays, so a value a driver sees always matches its risk band.
    """

    wind_mph: float
    gust_mph: float
    rain_in_hr: float
    snow_in_hr: float

    @classmethod
    def measured(
        cls, *, wind_mph: float, gust_mph: float, rain_in_hr: float, snow_in_hr: float
    ) -> Conditions:
        return cls(
            wind_mph=round(wind_mph, 1),
            gust_mph=round(gust_mph, 1),
            rain_in_hr=round(rain_in_hr, 2),
            snow_in_hr=round(snow_in_hr, 2),
        )


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    level: RiskLevel
    factor_levels: dict[Factor, RiskLevel]
    drivers: tuple[Factor, ...]
    """Factors whose level equals the overall level (empty when Low)."""
    load_rule: LoadRule | None
    """The load rule that raised the wind level, if any."""


def assess(conditions: Conditions, load_lb: float) -> RiskAssessment:
    """Classify each factor, apply the load rules to wind, and take the worst."""
    wind_level = WIND_SCALE.classify(conditions.wind_mph)
    applied_rule: LoadRule | None = None
    for rule in LOAD_RULES:
        if rule.applies(conditions.wind_mph, load_lb) and rule.level > wind_level:
            wind_level, applied_rule = rule.level, rule

    factor_levels = {
        Factor.WIND: wind_level,
        Factor.RAIN: RAIN_SCALE.classify(conditions.rain_in_hr),
        Factor.SNOW: SNOW_SCALE.classify(conditions.snow_in_hr),
    }
    level = max(factor_levels.values())
    drivers = (
        tuple(factor for factor, lvl in factor_levels.items() if lvl == level)
        if level > RiskLevel.LOW
        else ()
    )
    return RiskAssessment(
        level=level,
        factor_levels=factor_levels,
        drivers=drivers,
        load_rule=applied_rule if Factor.WIND in drivers else None,
    )


def describe(conditions: Conditions, assessment: RiskAssessment) -> str:
    """One-line, plain-language reason for a checkpoint's risk level."""
    if assessment.level is RiskLevel.LOW:
        return "Calm: all conditions below risk thresholds"

    parts: list[str] = []
    for factor in assessment.drivers:
        if factor is Factor.WIND:
            text = f"Wind {conditions.wind_mph:.1f} mph"
            if assessment.load_rule is not None:
                text += f" ({assessment.load_rule.description})"
            parts.append(text)
        elif factor is Factor.RAIN:
            parts.append(f"Rain {conditions.rain_in_hr:.2f} in/hr")
        else:
            parts.append(f"Snow {conditions.snow_in_hr:.2f} in/hr")
    return f"{assessment.level.label}: " + ", ".join(parts)
