import { Component, Show, For, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { BalanceCard } from './BalanceCard'
import { SettlementPlan } from './SettlementPlan'

export const BalanceTab: Component = () => {
  const { balances, settlementPlan, activeGroup, members, identity, entries } = useAppContext()

  const getMemberName = (memberId: string): string => {
    if (memberId === identity()?.publicKeyHash) return 'You'
    const member = members().find(m => m.id === memberId)
    return member?.name || 'Unknown'
  }

  const myBalance = createMemo(() => {
    const userId = identity()?.publicKeyHash
    if (!userId) return null
    return balances().get(userId)
  })

  const otherBalances = createMemo(() => {
    const userId = identity()?.publicKeyHash
    if (!userId) return []

    return Array.from(balances().entries())
      .filter(([memberId]) => memberId !== userId)
      .sort((a, b) => Math.abs(b[1].netBalance) - Math.abs(a[1].netBalance))
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
        {/* Your Balance */}
        <Show when={myBalance()}>
          <div class="balance-section">
            <h2 class="balance-section-title">Your Balance</h2>
            <BalanceCard
              balance={myBalance()!}
              memberName="You"
              currency={currency()}
              isCurrentUser={true}
            />
          </div>
        </Show>

        {/* All Member Balances */}
        <Show when={otherBalances().length > 0}>
          <div class="balance-section">
            <h2 class="balance-section-title">Member Balances</h2>
            <div class="balance-list">
              <For each={otherBalances()}>
                {([memberId, balance]) => (
                  <BalanceCard
                    balance={balance}
                    memberName={getMemberName(memberId)}
                    currency={currency()}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>

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
