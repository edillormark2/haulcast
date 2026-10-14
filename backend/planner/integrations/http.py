"""HTTP plumbing shared by the upstream API clients."""

from __future__ import annotations

import logging
import threading
import time
from functools import cache
from types import TracebackType
from typing import Any

import httpx

from planner import conf

logger = logging.getLogger(__name__)

RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})
MAX_ATTEMPTS = 3
MAX_BACKOFF_S = 4.0


class UpstreamError(Exception):
    """An upstream service failed or returned something unusable."""

    def __init__(self, service: str, detail: str, *, status: int | None = None) -> None:
        super().__init__(f"{service}: {detail}")
        self.service = service
        self.detail = detail
        self.status = status


class HostThrottle:
    """Starts requests to one host at least `min_interval_s` apart (per
    process), as the public routing servers' fair-use policies ask."""

    def __init__(self, min_interval_s: float) -> None:
        self._min_interval_s = min_interval_s
        self._lock = threading.Lock()
        self._last_request_at = float("-inf")

    def __enter__(self) -> None:
        self._lock.acquire()
        wait = self._min_interval_s - (time.monotonic() - self._last_request_at)
        if wait > 0:
            time.sleep(wait)
        self._last_request_at = time.monotonic()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self._lock.release()


@cache
def shared_client() -> httpx.Client:
    """One pooled, thread-safe client for all upstream calls."""
    config = conf.upstream()
    return httpx.Client(
        headers={"User-Agent": config.user_agent, "Accept": "application/json"},
        timeout=httpx.Timeout(config.timeout_s, connect=5.0),
        transport=httpx.HTTPTransport(retries=1),  # reconnects on dropped sockets
        limits=httpx.Limits(max_connections=16, max_keepalive_connections=8),
    )


def request_json(service: str, method: str, url: str, **kwargs: Any) -> Any:
    """Send a request and decode its JSON body.

    Rate limits, gateway errors and timeouts are retried with exponential
    backoff (honouring Retry-After); anything else fails fast as UpstreamError.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started = time.perf_counter()
        try:
            response = shared_client().request(method, url, **kwargs)
        except httpx.TimeoutException as exc:
            if attempt == MAX_ATTEMPTS:
                raise UpstreamError(service, "timed out") from exc
            _sleep_before_retry(attempt, None)
            continue
        except httpx.HTTPError as exc:
            raise UpstreamError(service, f"request failed ({exc.__class__.__name__})") from exc

        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "%s %s %s → %s in %.0f ms", service, method, url, response.status_code, elapsed_ms
        )

        if response.status_code in RETRYABLE_STATUSES and attempt < MAX_ATTEMPTS:
            _sleep_before_retry(attempt, response.headers.get("Retry-After"))
            continue
        if response.is_error:
            raise UpstreamError(service, _error_detail(response), status=response.status_code)
        try:
            return response.json()
        except ValueError as exc:
            raise UpstreamError(service, "returned invalid JSON") from exc
    raise AssertionError("unreachable")  # pragma: no cover


def _sleep_before_retry(attempt: int, retry_after: str | None) -> None:
    delay = 0.5 * 2 ** (attempt - 1)
    if retry_after and retry_after.isdigit():
        delay = float(retry_after)
    time.sleep(min(delay, MAX_BACKOFF_S))


def _error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    if isinstance(body, dict):
        for key in ("error", "reason", "message"):
            if isinstance(body.get(key), str):
                return f"HTTP {response.status_code}: {body[key]}"
    return f"HTTP {response.status_code}"
