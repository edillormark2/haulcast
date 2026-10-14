/** A quad over the grid's bounds in Web Mercator units (0–1), built from gl_VertexID. */
export const VERTEX_SHADER = /* glsl */ `#version 300 es
uniform mat4 u_matrix;
uniform vec4 u_mercator; // west x, north y, east x, south y
out vec2 v_mercator;

void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  v_mercator = mix(u_mercator.xy, u_mercator.zw, corner);
  gl_Position = u_matrix * vec4(v_mercator, 0.0, 1.0);
}`

/**
 * Per pixel: Mercator to lon/lat to grid coordinates, then a Catmull-Rom
 * interpolation of wind, rain, snow and corridor weight between the 4×4
 * nearest cells (each fetch also blends the two surrounding hours), clamped
 * to the nearest four cells so it never invents values beyond the data.
 * Classifying the interpolated values (rather than interpolating risk
 * levels) keeps band edges physically real.
 */
export const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler3D u_weather;
uniform vec4 u_grid;          // west, south, east, north of the cell centres (degrees)
uniform vec2 u_size;          // columns, rows
uniform float u_frame;        // fractional hours since departure
uniform float u_frames;
uniform vec3 u_steps;         // physical value of one byte: wind, rain, snow
uniform vec4 u_wind_bounds;   // Moderate, High, Severe, No Travel lower bounds
uniform vec4 u_rain_bounds;
uniform vec4 u_snow_bounds;
uniform int u_metric;         // 0 risk, 1 wind, 2 rain, 3 snow
uniform vec4 u_colors[5];     // straight RGBA per level
uniform float u_opacity;
uniform float u_pixel_ratio;

in vec2 v_mercator;
out vec4 fragColor;

const float PI = 3.141592653589793;

vec4 catmullRomWeights(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1.0,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2
  );
}

// cell: position in cell units (0 … size - 1); w: texture depth for the hour.
vec4 sampleWeather(vec2 cell, float w) {
  vec2 base = floor(cell);
  vec2 f = cell - base;
  vec4 wx = catmullRomWeights(f.x);
  vec4 wy = catmullRomWeights(f.y);
  vec4 sum = vec4(0.0);
  vec4 lo = vec4(1.0);
  vec4 hi = vec4(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 texel = clamp(base + vec2(float(i - 1), float(j - 1)), vec2(0.0), u_size - 1.0);
      vec4 value = texture(u_weather, vec3((texel + 0.5) / u_size, w));
      sum += value * wx[i] * wy[j];
      if (i >= 1 && i <= 2 && j >= 1 && j <= 2) {
        lo = min(lo, value);
        hi = max(hi, value);
      }
    }
  }
  return clamp(sum, lo, hi);
}

// Number of bounds the value has crossed (0–4), antialiased over about a pixel.
float bandLevel(float value, vec4 bounds) {
  vec4 edge = vec4(fwidth(value) * 0.75 + 1e-5);
  vec4 crossed = smoothstep(bounds - edge, bounds + edge, vec4(value));
  return crossed.x + crossed.y + crossed.z + crossed.w;
}

void main() {
  float lon = v_mercator.x * 360.0 - 180.0;
  float lat = degrees(atan(sinh(PI * (1.0 - 2.0 * v_mercator.y))));
  vec2 g = (vec2(lon, lat) - u_grid.xy) / (u_grid.zw - u_grid.xy);
  vec4 texel = sampleWeather(g * (u_size - 1.0), (u_frame + 0.5) / u_frames);

  float corridor = smoothstep(0.02, 0.6, texel.a);

  vec3 value = texel.rgb * 255.0 * u_steps;
  vec3 levels = vec3(
    bandLevel(value.x, u_wind_bounds),
    bandLevel(value.y, u_rain_bounds),
    bandLevel(value.z, u_snow_bounds)
  );
  vec3 nearModerate = value / vec3(u_wind_bounds.x, u_rain_bounds.x, u_snow_bounds.x);

  float level;
  float approach;
  if (u_metric == 1) { level = levels.x; approach = nearModerate.x; }
  else if (u_metric == 2) { level = levels.y; approach = nearModerate.y; }
  else if (u_metric == 3) { level = levels.z; approach = nearModerate.z; }
  else {
    level = max(levels.x, max(levels.y, levels.z));
    approach = max(nearModerate.x, max(nearModerate.y, nearModerate.z));
  }

  // Calm air is nearly clear; it tints as it nears the Moderate threshold.
  vec4 low = vec4(u_colors[0].rgb, u_colors[0].a * mix(0.2, 1.0, clamp(approach, 0.0, 1.0)));
  int band = int(floor(level));
  vec4 from = band == 0 ? low : u_colors[band];
  vec4 color = mix(from, u_colors[min(band + 1, 4)], fract(level));

  // Diagonal hatching over No Travel, so it reads without colour.
  float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / (9.0 * u_pixel_ratio)));
  color.rgb = mix(color.rgb, vec3(1.0), 0.32 * hatch * smoothstep(3.5, 4.0, level));

  // Discard last: fwidth() above needs every pixel of the quad still running.
  if (corridor < 0.004) discard;
  float alpha = color.a * corridor * u_opacity;
  fragColor = vec4(color.rgb * alpha, alpha);
}`
