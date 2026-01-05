import { Component, For, createMemo } from 'solid-js'
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
  const groupEntriesByDate = (entries: Entry[]): GroupedEntries[] => {
    const now = Date.now()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const todayTime = today.getTime()

    const yesterday = new Date(todayTime)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayTime = yesterday.getTime()

    const thisWeek = new Date(todayTime)
    thisWeek.setDate(thisWeek.getDate() - 7)
    const thisWeekTime = thisWeek.getTime()

    const groups: Map<string, Entry[]> = new Map()

    // Sort entries by date (newest first)
    const sorted = [...entries].sort((a, b) => b.date - a.date)

    sorted.forEach(entry => {
      const entryDate = new Date(entry.date)
      entryDate.setHours(0, 0, 0, 0)
      const entryTime = entryDate.getTime()

      let label: string

      if (entryTime >= todayTime) {
        label = 'Today'
      } else if (entryTime >= yesterdayTime) {
        label = 'Yesterday'
      } else if (entryTime >= thisWeekTime) {
        label = 'This Week'
      } else {
        // Format as "Month Year" for older entries
        label = entryDate.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })
      }

      if (!groups.has(label)) {
        groups.set(label, [])
      }
      groups.get(label)!.push(entry)
    })

    // Convert to array and maintain order
    const result: GroupedEntries[] = []
    const orderLabels = ['Today', 'Yesterday', 'This Week']

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
