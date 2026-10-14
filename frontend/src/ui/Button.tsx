import type { ButtonHTMLAttributes } from 'react'

import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-ink-soft disabled:bg-ink/45',
  secondary:
    'bg-surface text-fg ring-1 ring-line-strong hover:bg-surface-2 disabled:text-fg-subtle',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg disabled:text-fg-subtle',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1 rounded-md px-2 text-xs',
  md: 'h-9 gap-1.5 rounded-lg px-3 text-sm',
  lg: 'h-11 gap-2 rounded-xl px-4 text-[15px]',
}

/** Press feedback is a 97% scale: quick to read, never bouncy. */
export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap select-none',
        'transition-[background-color,color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] disabled:active:scale-100',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    />
  )
}
