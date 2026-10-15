import { Combobox } from '@base-ui/react/combobox'
import { CircleNotchIcon, MapPinIcon, MapPinSimpleIcon, XIcon } from '@phosphor-icons/react'
import { useId, useMemo, useState } from 'react'

import { usePlaceSearch } from '../../api/queries'
import type { Place, PlaceSuggestion } from '../../api/types'
import { cx } from '../../lib/cx'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

interface PlaceFieldProps {
  label: string
  placeholder: string
  role: 'origin' | 'destination'
  value: Place | null
  onChange: (place: Place | null) => void
  error?: string | undefined
}

const asSuggestion = (place: Place): PlaceSuggestion => ({
  ...place,
  name: place.label,
  detail: '',
  kind: 'place',
})

/** Search-as-you-type place picker. Results come from the server, so no client filtering. */
export function PlaceField({ label, placeholder, role, value, onChange, error }: PlaceFieldProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 250)
  const search = usePlaceSearch(debounced)
  const selected = useMemo(() => (value ? asSuggestion(value) : null), [value])

  // Keep the selection among the items so its label survives new results.
  const results = search.data
  const items = useMemo(() => {
    const found = results ?? []
    if (!selected || found.some((item) => sameSpot(item, selected))) return found
    return [...found, selected]
  }, [results, selected])

  const typing = query.trim().length >= 2
  const waiting = typing && (debounced !== query || search.isFetching)
  const Icon = role === 'origin' ? MapPinSimpleIcon : MapPinIcon

  return (
    <Combobox.Root
      items={items}
      value={selected}
      filter={null}
      itemToStringLabel={(item: PlaceSuggestion) => item.label}
      isItemEqualToValue={sameSpot}
      onValueChange={(next) => {
        onChange(next ? { label: next.label, lat: next.lat, lon: next.lon } : null)
        setQuery('')
      }}
      onInputValueChange={(next, details) => {
        if (details.reason !== 'item-press') setQuery(next)
      }}
    >
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-fg-muted">
        {label}
      </label>
      <Combobox.InputGroup
        className={cx(
          'group relative flex h-10 items-center rounded-lg bg-surface ring-1 transition-shadow duration-150',
          'focus-within:ring-2 focus-within:ring-teal',
          error ? 'ring-risk-severe-text' : 'ring-line-strong',
        )}
      >
        <Icon
          size={16}
          weight={role === 'destination' ? 'fill' : 'bold'}
          className={cx('ml-3 shrink-0', role === 'origin' ? 'text-teal' : 'text-ink')}
          aria-hidden
        />
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        {waiting && (
          <CircleNotchIcon
            size={14}
            className="shrink-0 animate-spin text-fg-subtle"
            aria-label="Searching places"
          />
        )}
        <Combobox.Clear
          aria-label={`Clear ${label.toLowerCase()}`}
          className="mr-1.5 grid size-7 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <XIcon size={14} />
        </Combobox.Clear>
      </Combobox.InputGroup>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-risk-severe-text">
          {error}
        </p>
      )}

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={6} className="z-50">
          <Combobox.Popup
            aria-busy={waiting || undefined}
            className={cx(
              'max-h-80 w-(--anchor-width) min-w-64 overflow-y-auto rounded-xl bg-surface p-1 shadow-float ring-1 ring-ink/8',
              'origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out',
              'data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
            )}
          >
            <Combobox.Status className="px-3 py-2 text-xs text-fg-muted empty:hidden">
              {waiting ? 'Searching places…' : null}
            </Combobox.Status>
            <Combobox.Empty className="px-3 py-2 text-xs text-fg-muted empty:hidden">
              {typing && !waiting ? `No places match “${query.trim()}”.` : null}
            </Combobox.Empty>
            <Combobox.List>
              {(item: PlaceSuggestion) => (
                <Combobox.Item
                  key={`${item.lat},${item.lon}`}
                  value={item}
                  className="flex cursor-default items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-highlighted:bg-surface-2"
                >
                  <MapPinIcon size={15} className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{item.name}</span>
                    {item.detail && (
                      <span className="block truncate text-xs text-fg-muted">{item.detail}</span>
                    )}
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

function sameSpot(a: Place, b: Place): boolean {
  return a.lat === b.lat && a.lon === b.lon
}
