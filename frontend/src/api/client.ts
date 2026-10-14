import type {
  ApiErrorBody,
  HeatmapPayload,
  HeatmapRequest,
  Plan,
  PlaceSuggestion,
  RiskRules,
  TripRequest,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, unknown> | undefined

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.fields = body.fields
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...init, headers })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, {
      code: 'network',
      message: "Can't reach the server. Check your connection and try again.",
    })
  }
  if (response.ok) return (await response.json()) as T

  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  throw new ApiError(
    response.status,
    body?.error ?? { code: 'error', message: `Request failed (${response.status}).` },
  )
}

export const api = {
  rules: (signal?: AbortSignal) => request<RiskRules>('/rules/', { signal }),

  geocode: async (query: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q: query })
    const body = await request<{ results: PlaceSuggestion[] }>(`/geocode/?${params}`, { signal })
    return body.results
  },

  plan: (trip: TripRequest, signal?: AbortSignal) =>
    request<Plan>('/plans/', { method: 'POST', body: JSON.stringify(trip), signal }),

  heatmap: (heatmapRequest: HeatmapRequest, signal?: AbortSignal) =>
    request<HeatmapPayload>('/heatmap/', {
      method: 'POST',
      body: JSON.stringify(heatmapRequest),
      signal,
    }),
}
