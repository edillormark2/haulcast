import {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map,
  MercatorCoordinate,
} from 'maplibre-gl'

import type { HeatmapMetric } from '../../../api/types'
import { hexToRgb } from '../../../lib/color'
import type { HeatmapData } from '../../../lib/heatmap'
import { RISK, RISK_LEVELS, type RiskLevel } from '../../../lib/risk'
import { shaderBounds } from '../../../lib/thresholds'
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders'

const FADE_IN_MS = 450
const METRIC_INDEX: Record<HeatmapMetric, number> = { risk: 0, wind: 1, rain: 2, snow: 3 }
/** Opacity per level: calm air almost clear, No Travel strongest. */
const LEVEL_ALPHA: Record<RiskLevel, number> = {
  low: 0.16,
  moderate: 0.5,
  high: 0.55,
  severe: 0.6,
  no_travel: 0.66,
}
/** Calm air uses the brighter brand teal: the dark route teal turns grey when faint. */
const heatmapColor = (level: RiskLevel) => (level === 'low' ? '#008080' : RISK[level].color)
const COLORS = new Float32Array(
  RISK_LEVELS.flatMap((level) => [
    ...hexToRgb(heatmapColor(level)).map((channel) => channel / 255),
    LEVEL_ALPHA[level],
  ]),
)

const UNIFORMS = [
  'u_matrix',
  'u_mercator',
  'u_weather',
  'u_grid',
  'u_size',
  'u_frame',
  'u_frames',
  'u_steps',
  'u_wind_bounds',
  'u_rain_bounds',
  'u_snow_bounds',
  'u_metric',
  'u_colors',
  'u_opacity',
  'u_pixel_ratio',
] as const
type Uniform = (typeof UNIFORMS)[number]

interface GpuResources {
  program: WebGLProgram
  uniforms: Record<Uniform, WebGLUniformLocation | null>
  vao: WebGLVertexArrayObject
  texture: WebGLTexture | null
}

/**
 * The corridor weather heatmap as a MapLibre custom layer.
 *
 * All 49 hourly frames live in one 3D texture, so moving the forecast slider
 * only changes a uniform: no network, no CPU resampling, no uploads. The GPU
 * interpolates between grid cells and between hours in a single fetch.
 *
 * GL work happens only inside `prerender`/`render`, where MapLibre has reset
 * the context and resynchronises its state cache afterwards.
 */
export class HeatmapLayer implements CustomLayerInterface {
  readonly id: string
  readonly type = 'custom' as const
  readonly renderingMode = '2d' as const

  private map: Map | null = null
  private gpu: GpuResources | null = null
  private data: HeatmapData | null = null
  private needsUpload = false
  private metric: HeatmapMetric = 'risk'
  private frame = 0
  private visible = true
  private fadeStartedAt = 0
  /** Reused every frame: MapLibre may hand over a 64-bit matrix. */
  private readonly matrix = new Float32Array(16)

  constructor(id: string) {
    this.id = id
  }

  onAdd(map: Map): void {
    this.map = map
    this.needsUpload = this.data !== null
    map.on('webglcontextlost', this.onContextLost)
    map.on('webglcontextrestored', this.onContextRestored)
  }

  onRemove(map: Map, gl: WebGL2RenderingContext): void {
    map.off('webglcontextlost', this.onContextLost)
    map.off('webglcontextrestored', this.onContextRestored)
    if (this.gpu) {
      if (this.gpu.texture) gl.deleteTexture(this.gpu.texture)
      gl.deleteVertexArray(this.gpu.vao)
      gl.deleteProgram(this.gpu.program)
    }
    this.gpu = null
    this.map = null
  }

  setData(data: HeatmapData | null): void {
    this.data = data
    this.needsUpload = true
    this.fadeStartedAt = performance.now()
    this.map?.triggerRepaint()
  }

  setFrame(frame: number): void {
    if (frame === this.frame) return
    this.frame = frame
    this.map?.triggerRepaint()
  }

  setMetric(metric: HeatmapMetric): void {
    if (metric === this.metric) return
    this.metric = metric
    this.map?.triggerRepaint()
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    this.map?.triggerRepaint()
  }

  prerender(gl: WebGL2RenderingContext): void {
    this.gpu ??= createResources(gl)
    if (!this.needsUpload) return
    if (this.gpu.texture) gl.deleteTexture(this.gpu.texture)
    this.gpu.texture = this.data ? uploadWeather(gl, this.data) : null
    this.needsUpload = false
  }

  render(gl: WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    const { gpu, data, map } = this
    if (!this.visible || !gpu?.texture || !data || !map) return
    if (options.shaderData.variantName !== 'mercator') return

    const { grid } = data
    const [west, north] = mercator(grid.west, grid.north)
    const [east, south] = mercator(grid.east, grid.south)
    const fade = Math.min((performance.now() - this.fadeStartedAt) / FADE_IN_MS, 1)
    // Fade the overlay as the user zooms in, so street detail stays readable.
    const zoomOpacity = Math.min(Math.max(1.1 - 0.07 * (map.getZoom() - 4), 0.55), 1)
    const { uniforms: u } = gpu

    gl.useProgram(gpu.program)
    gl.bindVertexArray(gpu.vao)
    this.matrix.set(options.defaultProjectionData.mainMatrix)
    gl.uniformMatrix4fv(u.u_matrix, false, this.matrix)
    gl.uniform4f(u.u_mercator, west, north, east, south)
    gl.uniform4f(u.u_grid, grid.west, grid.south, grid.east, grid.north)
    gl.uniform2f(u.u_size, grid.columns, grid.rows)
    gl.uniform1f(u.u_frame, Math.min(Math.max(this.frame, 0), data.frames - 1))
    gl.uniform1f(u.u_frames, data.frames)
    gl.uniform3f(u.u_steps, data.steps.wind, data.steps.rain, data.steps.snow)
    gl.uniform4fv(u.u_wind_bounds, shaderBounds(data.thresholds.wind, data.steps.wind))
    gl.uniform4fv(u.u_rain_bounds, shaderBounds(data.thresholds.rain, data.steps.rain))
    gl.uniform4fv(u.u_snow_bounds, shaderBounds(data.thresholds.snow, data.steps.snow))
    gl.uniform1i(u.u_metric, METRIC_INDEX[this.metric])
    gl.uniform4fv(u.u_colors, COLORS)
    gl.uniform1f(u.u_opacity, (1 - (1 - fade) ** 3) * zoomOpacity)
    gl.uniform1f(u.u_pixel_ratio, window.devicePixelRatio || 1)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, gpu.texture)
    gl.uniform1i(u.u_weather, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)

    if (fade < 1) map.triggerRepaint()
  }

  private readonly onContextLost = () => {
    this.gpu = null
  }

  private readonly onContextRestored = () => {
    this.needsUpload = this.data !== null
    this.map?.triggerRepaint()
  }
}

function mercator(lon: number, lat: number): [number, number] {
  const point = MercatorCoordinate.fromLngLat({ lng: lon, lat })
  return [point.x, point.y]
}

function uploadWeather(gl: WebGL2RenderingContext, data: HeatmapData): WebGLTexture {
  const { columns, rows } = data.grid
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_3D, texture)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA8,
    columns,
    rows,
    data.frames,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data.texels,
  )
  return texture
}

function createResources(gl: WebGL2RenderingContext): GpuResources {
  const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
  const uniforms = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<Uniform, WebGLUniformLocation | null>
  return { program, uniforms, vao: gl.createVertexArray(), texture: null }
}

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()
  const shaders: WebGLShader[] = []
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)
    if (!shader) throw new Error('Could not create a heatmap shader')
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Heatmap shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ''}`)
    }
    gl.attachShader(program, shader)
    shaders.push(shader)
  }
  gl.linkProgram(program)
  for (const shader of shaders) gl.deleteShader(shader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Heatmap shader failed to link: ${gl.getProgramInfoLog(program) ?? ''}`)
  }
  return program
}
