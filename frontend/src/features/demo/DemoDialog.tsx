import { PlayIcon, XIcon } from '@phosphor-icons/react'
import { useId, useLayoutEffect, useRef, useState } from 'react'

import { useUiStore } from '../../state/uiStore'
import { DEMO, markDemoSeen } from './demo'

/** Length of the closing fade; the player stays mounted until it has run. */
const CLOSE_MS = 160

/**
 * The narrated tour in a native modal dialog: the page behind is inert,
 * Escape and a click outside close it, and focus returns to the button that
 * opened it. The video element exists only while the dialog is open, so the
 * file is fetched only when someone asks to watch.
 */
export function DemoDialog() {
  const open = useUiStore((state) => state.demoOpen)
  const closeDemo = useUiStore((state) => state.closeDemo)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const openerRef = useRef<Element | null>(null)
  const titleId = useId()
  const [closing, setClosing] = useState(false)

  // A layout effect runs inside the click that opened the dialog, so phones
  // that only allow sound from a tap still start the narration.
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const video = videoRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      openerRef.current = document.activeElement
      dialog.showModal()
      markDemoSeen()
      if (video) {
        video.focus({ preventScroll: true })
        video.play().catch(() => {
          // Autoplay refused: the poster and its play control stay up.
        })
      }
    } else if (!open && dialog.open) {
      video?.pause()
      dialog.close()
      const opener = openerRef.current
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open])

  const requestClose = () => {
    setClosing(true)
    window.setTimeout(() => setClosing(false), CLOSE_MS)
    closeDemo()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: close through the same path, so the fade and focus return match.
        event.preventDefault()
        requestClose()
      }}
      onClose={() => {
        if (useUiStore.getState().demoOpen) closeDemo()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
      className={[
        'm-auto max-h-none max-w-none overflow-visible border-0 bg-transparent p-3 text-white outline-none',
        'w-[min(1124px,100vw,calc((100dvh_-_80px)*16/9_+_24px))]',
        'scale-[0.96] opacity-0 transition-[opacity,scale,display,overlay] transition-discrete duration-150 ease-out',
        'open:scale-100 open:opacity-100 open:duration-200 starting:open:scale-[0.96] starting:open:opacity-0',
        'backdrop:bg-ink/0 backdrop:transition-[background-color,display,overlay] backdrop:transition-discrete backdrop:duration-200',
        'open:backdrop:bg-ink/80 starting:open:backdrop:bg-ink/0',
      ].join(' ')}
    >
      <div className="overflow-hidden rounded-2xl bg-ink shadow-[0_32px_80px_-24px_rgb(0_0_0/0.7)] ring-1 ring-white/10">
        <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-4">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-coral">
            <PlayIcon size={12} weight="fill" className="translate-x-px" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-sm font-semibold">
              {DEMO.title}
            </h2>
            <p className="truncate text-2xs text-aqua/80">
              A {DEMO.duration} narrated tour, with captions
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close the demo"
            className="ml-auto grid size-9 shrink-0 place-items-center rounded-full text-white/75 transition-[background-color,color,scale] duration-150 ease-out hover:bg-white/10 hover:text-white active:scale-[0.94]"
          >
            <XIcon size={18} weight="bold" aria-hidden />
          </button>
        </div>
        <div className="aspect-video bg-black">
          {(open || closing) && (
            <video
              ref={videoRef}
              className="block size-full outline-none"
              controls
              playsInline
              preload="auto"
              poster={DEMO.poster}
            >
              {DEMO.sources.map((source) => (
                <source key={source.src} src={source.src} type={source.type} />
              ))}
              <track kind="captions" src={DEMO.captions} srcLang="en" label="English" />
            </video>
          )}
        </div>
      </div>
    </dialog>
  )
}
