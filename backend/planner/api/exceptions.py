"""One error envelope for every failure: {"error": {"code", "message", ...}}."""

from __future__ import annotations

import logging
import math
from typing import Any

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from planner.domain.forecast import ForecastUnavailableError
from planner.integrations.http import UpstreamError
from planner.integrations.valhalla import NoRouteError

logger = logging.getLogger(__name__)

MINUTE_S = 60


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, NoRouteError):
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "no_route",
            "No drivable truck route connects these places. Try locations on the road network.",
        )
    if isinstance(exc, ForecastUnavailableError):
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "forecast_unavailable",
            "The forecast doesn't reach part of this trip. Try an earlier departure.",
        )
    if isinstance(exc, UpstreamError):
        logger.warning("Upstream failure: %s", exc)
        if exc.rate_limited:
            return _busy(exc.service, exc.retry_after_s)
        return _error(
            status.HTTP_502_BAD_GATEWAY,
            "upstream_error",
            f"{exc.service} didn't respond as expected. Try again shortly.",
            service=exc.service,
        )
    if isinstance(exc, exceptions.ValidationError):
        return _error(
            status.HTTP_400_BAD_REQUEST,
            "invalid_request",
            "Some trip details need fixing.",
            fields=exc.detail,
        )
    if isinstance(exc, exceptions.Throttled):
        wait = _whole_seconds(getattr(exc, "wait", None))
        return _retry_later(
            _error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many requests. Wait a moment and try again.",
                retry_after=wait,
            ),
            wait,
        )

    response = exception_handler(exc, context)
    if response is not None:
        data = response.data if isinstance(response.data, dict) else {}
        response.data = {"error": {"code": "error", "message": str(data.get("detail", "Failed."))}}
    return response


def _error(status_code: int, code: str, message: str, **extra: Any) -> Response:
    return Response({"error": {"code": code, "message": message, **extra}}, status=status_code)


def _busy(service: str, retry_after_s: float | None) -> Response:
    """A free service refused this server. `retry_after` (whole seconds, when
    known) says when to try again: within a minute for a per-minute limit,
    later for a used-up hourly or daily quota."""
    wait = _whole_seconds(retry_after_s)
    if wait is None or wait <= MINUTE_S:
        message = f"{service} is busy right now. Try again in a minute."
    else:
        message = (
            f"This server has used up {service}'s free quota for now. "
            f"Try again in {_duration(wait)}."
        )
    return _retry_later(
        _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "upstream_busy",
            message,
            service=service,
            retry_after=wait,
        ),
        wait,
    )


def _retry_later(response: Response, wait: int | None) -> Response:
    if wait is not None:
        response["Retry-After"] = str(wait)
    return response


def _whole_seconds(seconds: float | None) -> int | None:
    return None if seconds is None else math.ceil(seconds)


def _duration(seconds: int) -> str:
    """About how long, in words: "25 minutes", "about 3 hours"."""
    if seconds < 90 * MINUTE_S:
        return f"{math.ceil(seconds / MINUTE_S)} minutes"
    return f"about {round(seconds / 3600)} hours"
