import { useId } from 'react'

import { cx } from '../lib/cx'

interface Option<T> {
  value: T
  label: string
}

interface SegmentedProps<T extends string | number> {
  legend: string
  value: T
  options: readonly Option<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

/**
 * A segmented control built on native radio buttons: arrow keys, form
 * semantics and screen-reader support come for free. The selected pill
 * slides between options.
 */
export function Segmented<T extends string | number>({
  legend,
  value,
  options,
  onChange,
  size = 'md',
  className,
}: SegmentedProps<T>) {
  const name = useId()
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  )
  return (
    <fieldset className={className}>
      <legend className="sr-only">{legend}</legend>
      <div
        className="relative grid rounded-lg bg-surface-2 p-0.5 ring-1 ring-line"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 rounded-md bg-surface shadow-[0_1px_2px_rgb(4_61_76/0.12),0_0_0_1px_rgb(4_61_76/0.06)] transition-transform duration-200 ease-out"
          style={{
            width: `calc((100% - 4px) / ${options.length})`,
            transform: `translateX(${index * 100}%)`,
          }}
        />
        {options.map((option) => (
          <label key={String(option.value)} className="relative">
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cx(
                'block cursor-pointer rounded-md text-center font-semibold whitespace-nowrap tabular-nums transition-colors duration-150',
                'text-fg-muted peer-checked:text-fg hover:text-fg',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-teal',
                size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs',
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
