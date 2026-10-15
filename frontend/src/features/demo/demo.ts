/**
 * The narrated product tour, served from public/demo. File names carry a
 * version, so the CDN can cache them for a year (see vercel.json); a new cut
 * gets a new name.
 */
export const DEMO = {
  title: 'How Haulcast works',
  /** As the player shows it (88.9 s). */
  duration: '1:28',
  poster: '/demo/haulcast-demo-v1-poster.webp',
  captions: '/demo/haulcast-demo-v1.en.vtt',
  /** The browser plays the first one it can: AV1 (9 MB), else H.264 (14 MB). */
  sources: [
    {
      src: '/demo/haulcast-demo-v1.av1.mp4',
      type: 'video/mp4; codecs="av01.0.08M.08, mp4a.40.2"',
    },
    {
      src: '/demo/haulcast-demo-v1.h264.mp4',
      type: 'video/mp4; codecs="avc1.640029, mp4a.40.2"',
    },
  ],
} as const

const SEEN_KEY = 'haulcast:demo-seen'

/** Whether this browser has opened the demo before (storage can be blocked). */
export function hasSeenDemo(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markDemoSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Private browsing or blocked storage: the button just keeps its first-visit cue.
  }
}

let posterWarmed = false

/** Fetches the poster on hover or focus, so the dialog paints it at once. */
export function warmDemoPoster(): void {
  if (posterWarmed) return
  posterWarmed = true
  new Image().src = DEMO.poster
}
