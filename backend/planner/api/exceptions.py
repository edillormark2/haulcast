"""One error envelope for every failure: {"error": {"code", "message", ...}}."""

from __future__ import annotations

import logging
from typing import Any

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from planner.domain.forecast import ForecastUnavailableError
from planner.integrations.http import UpstreamError
from planner.integrations.valhalla import NoRouteError

logger = logging.getLogger(__name__)


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
        busy = exc.status == status.HTTP_429_TOO_MANY_REQUESTS
        return _error(
            status.HTTP_503_SERVICE_UNAVAILABLE if busy else status.HTTP_502_BAD_GATEWAY,
            "upstream_busy" if busy else "upstream_error",
            f"{exc.service} is busy right now. Try again in a minute."
            if busy
            else f"{exc.service} didn't respond as expected. Try again shortly.",
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
        return _error(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many requests. Wait a moment and try again.",
            retry_after=getattr(exc, "wait", None),
        )

    response = exception_handler(exc, context)
    if response is not None:
        data = response.data if isinstance(response.data, dict) else {}
        response.data = {"error": {"code": "error", "message": str(data.get("detail", "Failed."))}}
    return response


def _error(status_code: int, code: str, message: str, **extra: Any) -> Response:
    return Response({"error": {"code": code, "message": message, **extra}}, status=status_code)
