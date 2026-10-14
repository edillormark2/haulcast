/** The Haulcast mark: a route with three checkpoints in the brand colours. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0d5567" />
      <path
        d="M8 23.5c4.5 0 4-12 8.5-12s4 9.5 7.5 3.5"
        fill="none"
        stroke="#bcddde"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity=".6"
      />
      <circle cx="8" cy="23.5" r="3.2" fill="#008080" />
      <circle cx="16.5" cy="11.5" r="2.8" fill="#bcddde" />
      <circle cx="24" cy="15" r="3.2" fill="#f84960" />
    </svg>
  )
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-none">
        <p className="text-[17px] font-bold tracking-[-0.01em] text-white">Haulcast</p>
        <p className="mt-1 text-2xs text-aqua/80">Weather-aware truck routing</p>
      </div>
    </div>
  )
}
