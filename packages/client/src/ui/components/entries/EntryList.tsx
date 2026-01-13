import { Component, For, createMemo } from 'solid-js'
import { useI18n, getDateGroupLabel } from '../../../i18n'
import { EntryCard } from './EntryCard'
import type { Entry } from '@partage/shared'

interface GroupedEntries {
  label: string
  entries: Entry[]
}

export interface EntryListProps {
  entries: Entry[]
}

export const EntryList: Component<EntryListProps> = (props) => {
  const { t, locale } = useI18n()

  const groupEntriesByDate = (entries: Entry[]): GroupedEntries[] => {
    const groups: Map<string, Entry[]> = new Map()

    // Helper to get day start timestamp (midnight)
    const getDayStart = (timestamp: number): number => {
      const date = new Date(timestamp)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }

    // Sort entries by date day (newest first), then by creation time (newest first) within same day
    const sorted = [...entries].sort((a, b) => {
      const aDayStart = getDayStart(a.date)
      const bDayStart = getDayStart(b.date)

      if (aDayStart !== bDayStart) {
        return bDayStart - aDayStart
      }
      // Same day, sort by creation time (newest first)
      return b.createdAt - a.createdAt
    })

    sorted.forEach(entry => {
      const label = getDateGroupLabel(entry.date, locale(), t)

      if (!groups.has(label)) {
        groups.set(label, [])
      }
      groups.get(label)!.push(entry)
    })

    // Convert to array and maintain order
    const result: GroupedEntries[] = []
    const orderLabels = [t('entries.today'), t('entries.yesterday'), t('entries.thisWeek')]

    // Add ordered labels first
    orderLabels.forEach(label => {
      if (groups.has(label)) {
        result.push({ label, entries: groups.get(label)! })
        groups.delete(label)
      }
    })

    // Add remaining groups (month/year) in chronological order
    Array.from(groups.entries())
      .sort((a, b) => {
        // Sort by first entry date in each group (newest first)
        const dateA = a[1][0]?.date || 0
        const dateB = b[1][0]?.date || 0
        return dateB - dateA
      })
      .forEach(([label, entries]) => {
        result.push({ label, entries })
      })

    return result
  }

  const groupedEntries = createMemo(() => groupEntriesByDate(props.entries))

  return (
    <div class="entry-list">
      <For each={groupedEntries()}>
        {(group) => (
          <div class="entry-group">
            <h3 class="entry-group-title">{group.label}</h3>
            <div class="entry-group-items">
              <For each={group.entries}>
                {(entry) => <EntryCard entry={entry} />}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}
