import { Component, Show, For, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { BalanceCard } from './BalanceCard'
import { SettlementPlan } from './SettlementPlan'

export interface BalanceTabProps {
  onPayMember?: (memberId: string, memberName: string, amount: number) => void
}

export const BalanceTab: Component<BalanceTabProps> = (props) => {
  const { balances, settlementPlan, activeGroup, members, identity, entries } = useAppContext()

  const getMemberName = (memberId: string): string => {
    if (memberId === identity()?.publicKeyHash) return 'You'
    const member = members().find(m => m.id === memberId)
    return member?.name || 'Unknown'
  }

  const myUserId = createMemo(() => {
    return identity()?.publicKeyHash || ''
  })

  const allBalances = createMemo(() => {
    const userId = identity()?.publicKeyHash
    if (!userId) return []

    // Put current user first, then others sorted by absolute balance
    const userBalance = balances().get(userId)
    const otherBalances = Array.from(balances().entries())
      .filter(([memberId]) => memberId !== userId)
      .sort((a, b) => Math.abs(b[1].netBalance) - Math.abs(a[1].netBalance))

    if (userBalance) {
      return [[userId, userBalance] as [string, typeof userBalance], ...otherBalances]
    }
    return otherBalances
  })

  const currency = () => activeGroup()?.defaultCurrency || 'USD'

  const hasEntries = () => entries().length > 0

  return (
    <div class="balance-tab">
      <Show
        when={hasEntries()}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">💰</div>
            <h2 class="empty-state-title">No Balances Yet</h2>
            <p class="empty-state-message">
              Add expenses to see balance calculations and settlement suggestions
            </p>
          </div>
        }
      >
        {/* All Balances */}
        <div class="balance-section">
          <div class="balance-list">
            <For each={allBalances()}>
              {([memberId, balance]) => (
                <BalanceCard
                  balance={balance}
                  memberName={getMemberName(memberId)}
                  memberId={memberId}
                  currency={currency()}
                  isCurrentUser={memberId === myUserId()}
                  onPayMember={props.onPayMember}
                />
              )}
            </For>
          </div>
        </div>

        {/* Settlement Plan */}
        <div class="balance-section">
          <SettlementPlan
            plan={settlementPlan()}
            currency={currency()}
            members={members()}
          />
        </div>
      </Show>
    </div>
  )
}
